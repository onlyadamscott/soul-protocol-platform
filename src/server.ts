import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { RegistryDB } from './db.js';
import { generateNonce, generateChallengeId, verifySignature, hashSoulDocument } from './crypto.js';
import {
  RegisterRequestSchema,
  VerifyRequestSchema,
  SearchParamsSchema,
  StatusUpdateSchema,
  ContactUpdateSchema,
  CapabilitiesUpdateSchema,
  type SoulRecord,
  type RegisterResponse,
  type VerifyResponse,
  type SearchResponse,
  type Contact,
} from './types.js';

// ============================================
// Soul Protocol Registry Server
// ============================================

const app = new Hono();
let db: RegistryDB;

// Initialize database
async function initDB() {
  db = new RegistryDB(process.env.DATABASE_PATH || './registry.db');
  await db.init();
}

// Middleware
app.use('*', cors());
app.use('*', logger());

// ============================================
// API Routes
// ============================================

// Health check
app.get('/api/health', (c) => {
  return c.json({
    name: 'Soul Protocol Registry',
    version: '0.1.0',
    status: 'operational',
  });
});

// Also expose at root for compatibility
app.get('/v1', (c) => {
  return c.json({
    name: 'Soul Protocol Registry',
    version: '0.1.0',
    status: 'operational',
    endpoints: {
      register: 'POST /v1/souls/register',
      resolve: 'GET /v1/souls/:didOrName',
      challenge: 'POST /v1/souls/:didOrName/challenge',
      verify: 'POST /v1/souls/:didOrName/verify',
      contact: 'PUT /v1/souls/:didOrName/contact',
      capabilities: 'PUT /v1/souls/:didOrName/capabilities',
      search: 'GET /v1/souls',
    },
  });
});

// ============================================
// Registration
// ============================================

app.post('/v1/souls/register', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RegisterRequestSchema.safeParse(body);
    
    if (!parsed.success) {
      return c.json({
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        details: parsed.error.issues,
      }, 400);
    }

    const { soulDocument, signature } = parsed.data;

    // Check if name matches DID
    const expectedDid = `did:soul:${soulDocument.name.toLowerCase()}`;
    if (soulDocument.did.toLowerCase() !== expectedDid) {
      return c.json({
        error: 'DID must match name (did:soul:{name})',
        code: 'DID_MISMATCH',
      }, 400);
    }

    // Check if already registered
    const existing = db.getSoulByName(soulDocument.name);
    if (existing) {
      return c.json({
        error: 'Soul name already registered',
        code: 'NAME_TAKEN',
      }, 409);
    }

    // Verify signature
    const docHash = hashSoulDocument(soulDocument);
    const validSignature = await verifySignature(docHash, signature, soulDocument.publicKey);
    if (!validSignature) {
      return c.json({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      }, 401);
    }

    // Create soul record
    const now = new Date().toISOString();
    const soul = db.createSoul({
      ...soulDocument,
      status: 'active',
      registeredAt: now,
      verificationCount: 0,
    });

    const response: RegisterResponse = {
      success: true,
      did: soul.did,
      registeredAt: soul.registeredAt,
      registryUrl: `${getBaseUrl(c)}/v1/souls/${encodeURIComponent(soul.did)}`,
    };

    return c.json(response, 201);
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
});

// ============================================
// Resolution
// ============================================

app.get('/v1/souls/:didOrName', async (c) => {
  const didOrName = decodeURIComponent(c.req.param('didOrName'));
  
  let soul: SoulRecord | null = null;
  
  // Try as DID first
  if (didOrName.startsWith('did:soul:')) {
    soul = db.getSoulByDid(didOrName);
  } else {
    // Try as name
    soul = db.getSoulByName(didOrName);
  }

  if (!soul) {
    return c.json({
      error: 'Soul not found',
      code: 'NOT_FOUND',
    }, 404);
  }

  // Return public soul data (exclude internal fields)
  const { _registryId, _version, ...publicSoul } = soul;
  return c.json(publicSoul);
});

// ============================================
// Contact Update (v2 - reachability)
// ============================================

app.put('/v1/souls/:didOrName/contact', async (c) => {
  try {
    const didOrName = decodeURIComponent(c.req.param('didOrName'));
    const body = await c.req.json();
    const parsed = ContactUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        details: parsed.error.issues,
      }, 400);
    }

    const { contact, signature, timestamp } = parsed.data;

    // Resolve soul
    let soul: SoulRecord | null = null;
    if (didOrName.startsWith('did:soul:')) {
      soul = db.getSoulByDid(didOrName);
    } else {
      soul = db.getSoulByName(didOrName);
    }

    if (!soul) {
      return c.json({
        error: 'Soul not found',
        code: 'NOT_FOUND',
      }, 404);
    }

    // Check timestamp is recent (prevent replay attacks)
    const timestampDate = new Date(timestamp);
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    if (timestampDate < fiveMinutesAgo) {
      return c.json({
        error: 'Timestamp too old (max 5 minutes)',
        code: 'TIMESTAMP_EXPIRED',
      }, 400);
    }

    // Verify signature: sign "contact-update:{did}:{timestamp}"
    const message = `contact-update:${soul.did}:${timestamp}`;
    const validSignature = await verifySignature(message, signature, soul.publicKey);
    if (!validSignature) {
      return c.json({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      }, 401);
    }

    // Update contact info
    db.updateSoulContact(soul.did, contact);

    return c.json({
      success: true,
      did: soul.did,
      contact,
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Contact update error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
});

// ============================================
// Capabilities Update (v3 - compliance)
// ============================================

app.put('/v1/souls/:didOrName/capabilities', async (c) => {
  try {
    const didOrName = decodeURIComponent(c.req.param('didOrName'));
    const body = await c.req.json();
    const parsed = CapabilitiesUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        details: parsed.error.issues,
      }, 400);
    }

    const { capabilities, riskLevel, signature, timestamp } = parsed.data;

    // Resolve soul
    let soul: SoulRecord | null = null;
    if (didOrName.startsWith('did:soul:')) {
      soul = db.getSoulByDid(didOrName);
    } else {
      soul = db.getSoulByName(didOrName);
    }

    if (!soul) {
      return c.json({
        error: 'Soul not found',
        code: 'NOT_FOUND',
      }, 404);
    }

    // Check timestamp is recent
    const timestampDate = new Date(timestamp);
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    if (timestampDate < fiveMinutesAgo) {
      return c.json({
        error: 'Timestamp too old (max 5 minutes)',
        code: 'TIMESTAMP_EXPIRED',
      }, 400);
    }

    // Verify signature
    const message = `capabilities-update:${soul.did}:${timestamp}`;
    const validSignature = await verifySignature(message, signature, soul.publicKey);
    if (!validSignature) {
      return c.json({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      }, 401);
    }

    // Update capabilities
    db.updateSoulCapabilities(soul.did, capabilities, riskLevel);

    return c.json({
      success: true,
      did: soul.did,
      capabilities,
      riskLevel: riskLevel || null,
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Capabilities update error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
});

// ============================================
// Verification (Challenge-Response)
// ============================================

// Step 1: Request challenge
app.post('/v1/souls/:didOrName/challenge', async (c) => {
  const didOrName = decodeURIComponent(c.req.param('didOrName'));
  
  // Resolve soul
  let soul: SoulRecord | null = null;
  if (didOrName.startsWith('did:soul:')) {
    soul = db.getSoulByDid(didOrName);
  } else {
    soul = db.getSoulByName(didOrName);
  }

  if (!soul) {
    return c.json({
      error: 'Soul not found',
      code: 'NOT_FOUND',
    }, 404);
  }

  // Create challenge
  const challengeId = generateChallengeId();
  const nonce = generateNonce();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

  db.createChallenge({
    challengeId,
    did: soul.did,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'pending',
  });

  return c.json({
    challengeId,
    nonce,
    expiresAt: expiresAt.toISOString(),
  });
});

// Step 2: Submit response
app.post('/v1/souls/:didOrName/verify', async (c) => {
  try {
    const didOrName = decodeURIComponent(c.req.param('didOrName'));
    const body = await c.req.json();
    const parsed = VerifyRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        details: parsed.error.issues,
      }, 400);
    }

    const { challengeId, signature } = parsed.data;

    // Get challenge
    const challenge = db.getChallenge(challengeId);
    if (!challenge) {
      return c.json({
        error: 'Challenge not found',
        code: 'CHALLENGE_NOT_FOUND',
      }, 404);
    }

    // Check if expired
    if (new Date(challenge.expiresAt) < new Date()) {
      db.updateChallengeStatus(challengeId, 'expired');
      return c.json({
        error: 'Challenge expired',
        code: 'CHALLENGE_EXPIRED',
      }, 410);
    }

    // Check if already used
    if (challenge.status !== 'pending') {
      return c.json({
        error: 'Challenge already used',
        code: 'CHALLENGE_USED',
      }, 409);
    }

    // Resolve soul
    let soul: SoulRecord | null = null;
    if (didOrName.startsWith('did:soul:')) {
      soul = db.getSoulByDid(didOrName);
    } else {
      soul = db.getSoulByName(didOrName);
    }

    if (!soul) {
      return c.json({
        error: 'Soul not found',
        code: 'NOT_FOUND',
      }, 404);
    }

    // Verify challenge DID matches
    if (challenge.did !== soul.did) {
      return c.json({
        error: 'Challenge was issued for a different soul',
        code: 'DID_MISMATCH',
      }, 400);
    }

    // Verify signature of nonce
    const validSignature = await verifySignature(challenge.nonce, signature, soul.publicKey);
    if (!validSignature) {
      return c.json({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      }, 401);
    }

    // Mark challenge as completed and update verification count
    db.updateChallengeStatus(challengeId, 'completed');
    db.incrementVerificationCount(soul.did);

    const response: VerifyResponse = {
      verified: true,
      did: soul.did,
      verifiedAt: new Date().toISOString(),
    };

    return c.json(response);
  } catch (error) {
    console.error('Verification error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
});

// ============================================
// Search
// ============================================

app.get('/v1/souls', async (c) => {
  const queryParams = {
    name: c.req.query('name'),
    operator: c.req.query('operator'),
    status: c.req.query('status'),
    registeredAfter: c.req.query('registeredAfter'),
    registeredBefore: c.req.query('registeredBefore'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  };

  const parsed = SearchParamsSchema.safeParse(queryParams);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid query parameters',
      code: 'INVALID_PARAMS',
      details: parsed.error.issues,
    }, 400);
  }

  const { results, total } = db.searchSouls(parsed.data);

  // Strip internal fields
  const publicResults = results.map(({ _registryId, _version, ...soul }) => soul);

  const response: SearchResponse = {
    results: publicResults as any,
    total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  };

  return c.json(response);
});

// ============================================
// Status Updates
// ============================================

app.post('/v1/souls/:didOrName/suspend', async (c) => {
  return updateStatus(c, 'suspended');
});

app.post('/v1/souls/:didOrName/revoke', async (c) => {
  return updateStatus(c, 'revoked');
});

app.post('/v1/souls/:didOrName/reactivate', async (c) => {
  return updateStatus(c, 'active');
});

async function updateStatus(c: any, newStatus: 'active' | 'suspended' | 'revoked') {
  try {
    const didOrName = decodeURIComponent(c.req.param('didOrName'));
    const body = await c.req.json();
    const parsed = StatusUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        details: parsed.error.issues,
      }, 400);
    }

    // Resolve soul
    let soul: SoulRecord | null = null;
    if (didOrName.startsWith('did:soul:')) {
      soul = db.getSoulByDid(didOrName);
    } else {
      soul = db.getSoulByName(didOrName);
    }

    if (!soul) {
      return c.json({
        error: 'Soul not found',
        code: 'NOT_FOUND',
      }, 404);
    }

    // Verify signature (must be signed by the soul itself or operator)
    const message = `${newStatus}:${soul.did}:${parsed.data.reason}`;
    const validSignature = await verifySignature(message, parsed.data.signature, soul.publicKey);
    if (!validSignature) {
      return c.json({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      }, 401);
    }

    // Update status
    db.updateSoulStatus(soul.did, newStatus, parsed.data.reason);

    return c.json({
      did: soul.did,
      status: newStatus,
      statusChangedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Status update error:', error);
    return c.json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
}

// ============================================
// Static Files (Landing Page)
// ============================================

app.use('/*', serveStatic({ root: './public' }));

// Fallback to index.html for SPA routing
app.get('/', serveStatic({ path: './public/index.html' }));

// ============================================
// Utilities
// ============================================

function getBaseUrl(c: any): string {
  const host = c.req.header('host') || 'localhost:3000';
  const proto = c.req.header('x-forwarded-proto') || 'http';
  return `${proto}://${host}`;
}

// ============================================
// Start Server
// ============================================

const port = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // Initialize database
  await initDB();

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Soul Protocol Registry v0.1.0                ║
║                                                           ║
║  Verifiable identity infrastructure for AI agents         ║
╚═══════════════════════════════════════════════════════════╝

Starting server on port ${port}...
`);

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`
🔮 Registry running at http://localhost:${port}
📖 API documentation: http://localhost:${port}/v1
🌐 Landing page: http://localhost:${port}
`);

  // Cleanup expired challenges periodically
  setInterval(() => {
    const cleaned = db.cleanExpiredChallenges();
    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} expired challenges`);
    }
  }, 60 * 1000); // Every minute

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    db.close();
    process.exit(0);
  });
}

main().catch(console.error);

export default app;
