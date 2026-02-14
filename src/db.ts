import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { SoulRecord, Challenge, SoulStatus, Contact } from './types.js';

// ============================================
// Database Layer (using sql.js - pure JavaScript SQLite)
// ============================================

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

export class RegistryDB {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
  }

  async init() {
    if (this.initialized) return;
    
    SQL = await initSqlJs();
    
    // Load existing database or create new one
    if (this.dbPath !== ':memory:' && existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createSchema();
    this.initialized = true;
  }

  private createSchema() {
    // Souls table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS souls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        did TEXT UNIQUE NOT NULL,
        name TEXT UNIQUE NOT NULL COLLATE NOCASE,
        public_key TEXT NOT NULL,
        birth_timestamp TEXT NOT NULL,
        birth_operator TEXT NOT NULL,
        birth_base_model TEXT,
        birth_platform TEXT,
        birth_charter_hash TEXT,
        avatar TEXT,
        description TEXT,
        website TEXT,
        contact_json TEXT,
        capabilities_json TEXT,
        risk_level TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        status_reason TEXT,
        status_changed_at TEXT,
        registered_at TEXT NOT NULL,
        last_verified_at TEXT,
        verification_count INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Challenges table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        nonce TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_souls_name ON souls(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_souls_status ON souls(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_souls_operator ON souls(birth_operator)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_challenges_did ON challenges(did)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at)`);

    this.save();
  }

  private save() {
    if (this.dbPath !== ':memory:') {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
    }
  }

  // ============================================
  // Soul Operations
  // ============================================

  createSoul(soul: Omit<SoulRecord, '_registryId' | '_version'>): SoulRecord {
    this.db.run(`
      INSERT INTO souls (
        did, name, public_key,
        birth_timestamp, birth_operator, birth_base_model, birth_platform, birth_charter_hash,
        avatar, description, website, contact_json, capabilities_json, risk_level,
        status, registered_at, verification_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      soul.did,
      soul.name,
      soul.publicKey,
      soul.birth.timestamp,
      soul.birth.operator,
      soul.birth.baseModel || null,
      soul.birth.platform || null,
      soul.birth.charterHash || null,
      soul.avatar || null,
      soul.description || null,
      soul.website || null,
      soul.contact ? JSON.stringify(soul.contact) : null,
      soul.capabilities ? JSON.stringify(soul.capabilities) : null,
      soul.riskLevel || null,
      soul.status,
      soul.registeredAt,
      soul.verificationCount,
    ]);

    this.save();

    // Get the inserted ID
    const result = this.db.exec(`SELECT last_insert_rowid() as id`);
    const lastId = result[0]?.values[0]?.[0] as number;

    return {
      ...soul,
      _registryId: lastId,
      _version: 1,
    };
  }

  getSoulByDid(did: string): SoulRecord | null {
    const result = this.db.exec(`SELECT * FROM souls WHERE did = ?`, [did]);
    if (!result[0] || result[0].values.length === 0) return null;
    return this.rowToSoul(result[0].columns, result[0].values[0]);
  }

  getSoulByName(name: string): SoulRecord | null {
    const result = this.db.exec(`SELECT * FROM souls WHERE LOWER(name) = LOWER(?)`, [name]);
    if (!result[0] || result[0].values.length === 0) return null;
    return this.rowToSoul(result[0].columns, result[0].values[0]);
  }

  searchSouls(params: {
    name?: string;
    operator?: string;
    status?: SoulStatus;
    registeredAfter?: string;
    registeredBefore?: string;
    limit: number;
    offset: number;
  }): { results: SoulRecord[]; total: number } {
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (params.name) {
      conditions.push(`name LIKE ?`);
      bindings.push(params.name.replace('*', '%'));
    }
    if (params.operator) {
      conditions.push(`birth_operator LIKE ?`);
      bindings.push(params.operator.replace('*', '%'));
    }
    if (params.status) {
      conditions.push(`status = ?`);
      bindings.push(params.status);
    }
    if (params.registeredAfter) {
      conditions.push(`registered_at >= ?`);
      bindings.push(params.registeredAfter);
    }
    if (params.registeredBefore) {
      conditions.push(`registered_at <= ?`);
      bindings.push(params.registeredBefore);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = this.db.exec(`SELECT COUNT(*) as count FROM souls ${whereClause}`, bindings);
    const total = countResult[0]?.values[0]?.[0] as number || 0;

    // Get results
    const query = `
      SELECT * FROM souls ${whereClause}
      ORDER BY registered_at DESC
      LIMIT ? OFFSET ?
    `;
    const result = this.db.exec(query, [...bindings, params.limit, params.offset]);

    const results: SoulRecord[] = [];
    if (result[0]) {
      for (const row of result[0].values) {
        results.push(this.rowToSoul(result[0].columns, row));
      }
    }

    return { results, total };
  }

  updateSoulStatus(did: string, status: SoulStatus, reason: string): boolean {
    this.db.run(`
      UPDATE souls 
      SET status = ?, status_reason = ?, status_changed_at = ?, 
          version = version + 1, updated_at = datetime('now')
      WHERE did = ?
    `, [status, reason, new Date().toISOString(), did]);
    
    this.save();
    return this.db.getRowsModified() > 0;
  }

  incrementVerificationCount(did: string): void {
    this.db.run(`
      UPDATE souls 
      SET verification_count = verification_count + 1, 
          last_verified_at = ?,
          updated_at = datetime('now')
      WHERE did = ?
    `, [new Date().toISOString(), did]);
    
    this.save();
  }

  updateSoulContact(did: string, contact: Contact): boolean {
    this.db.run(`
      UPDATE souls 
      SET contact_json = ?, 
          version = version + 1, 
          updated_at = datetime('now')
      WHERE did = ?
    `, [JSON.stringify(contact), did]);
    
    this.save();
    return this.db.getRowsModified() > 0;
  }

  updateSoulCapabilities(did: string, capabilities: string[], riskLevel?: string): boolean {
    this.db.run(`
      UPDATE souls 
      SET capabilities_json = ?, 
          risk_level = ?,
          version = version + 1, 
          updated_at = datetime('now')
      WHERE did = ?
    `, [JSON.stringify(capabilities), riskLevel || null, did]);
    
    this.save();
    return this.db.getRowsModified() > 0;
  }

  private rowToSoul(columns: string[], values: unknown[]): SoulRecord {
    const row: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => {
      row[col] = values[i];
    });

    return {
      did: row.did as string,
      name: row.name as string,
      publicKey: row.public_key as string,
      birth: {
        timestamp: row.birth_timestamp as string,
        operator: row.birth_operator as string,
        baseModel: (row.birth_base_model as string) || undefined,
        platform: (row.birth_platform as string) || undefined,
        charterHash: (row.birth_charter_hash as string) || undefined,
      },
      avatar: (row.avatar as string) || undefined,
      description: (row.description as string) || undefined,
      website: (row.website as string) || undefined,
      contact: row.contact_json ? JSON.parse(row.contact_json as string) : undefined,
      capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json as string) : undefined,
      riskLevel: (row.risk_level as 'low' | 'medium' | 'high') || undefined,
      status: row.status as SoulStatus,
      statusReason: (row.status_reason as string) || undefined,
      statusChangedAt: (row.status_changed_at as string) || undefined,
      registeredAt: row.registered_at as string,
      lastVerifiedAt: (row.last_verified_at as string) || undefined,
      verificationCount: row.verification_count as number,
      _registryId: row.id as number,
      _version: row.version as number,
    };
  }

  // ============================================
  // Challenge Operations
  // ============================================

  createChallenge(challenge: Challenge): void {
    this.db.run(`
      INSERT INTO challenges (id, did, nonce, issued_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      challenge.challengeId,
      challenge.did,
      challenge.nonce,
      challenge.issuedAt,
      challenge.expiresAt,
      challenge.status,
    ]);
    
    this.save();
  }

  getChallenge(challengeId: string): Challenge | null {
    const result = this.db.exec(`SELECT * FROM challenges WHERE id = ?`, [challengeId]);
    if (!result[0] || result[0].values.length === 0) return null;

    const columns = result[0].columns;
    const values = result[0].values[0];
    const row: any = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });

    return {
      challengeId: row.id,
      did: row.did,
      nonce: row.nonce,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      status: row.status,
    };
  }

  updateChallengeStatus(challengeId: string, status: 'pending' | 'completed' | 'expired'): void {
    this.db.run(`UPDATE challenges SET status = ? WHERE id = ?`, [status, challengeId]);
    this.save();
  }

  cleanExpiredChallenges(): number {
    this.db.run(`
      DELETE FROM challenges 
      WHERE expires_at < datetime('now') AND status = 'pending'
    `);
    const changes = this.db.getRowsModified();
    if (changes > 0) this.save();
    return changes;
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
