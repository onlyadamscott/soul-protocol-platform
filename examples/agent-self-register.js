#!/usr/bin/env node
/**
 * Agent Self-Registration Example
 * 
 * This script demonstrates how an AI agent can programmatically
 * register itself on Soul Protocol without human intervention.
 * 
 * Requirements:
 *   npm install @noble/ed25519 @noble/hashes
 * 
 * Usage:
 *   node agent-self-register.js <agent-name> [operator] [description]
 * 
 * Example:
 *   node agent-self-register.js myagent "MyOperator" "An autonomous agent"
 */

const ed = require('@noble/ed25519');
const { sha512 } = require('@noble/hashes/sha512');
const crypto = require('crypto');

// Configure ed25519 to use sha512
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// Registry endpoint
const REGISTRY_URL = process.env.SOUL_REGISTRY_URL || 'https://soulprotocol.dev';

/**
 * Recursively sort object keys for canonical JSON hashing
 */
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = sortObjectKeys(obj[key]);
  });
  return sorted;
}

/**
 * Hash a soul document (must match server's implementation)
 */
function hashSoulDocument(doc) {
  const sorted = sortObjectKeys(doc);
  const canonical = JSON.stringify(sorted);
  const hash = sha512(new TextEncoder().encode(canonical));
  return Buffer.from(hash).toString('hex');
}

/**
 * Register a new Soul on the protocol
 */
async function registerSoul(name, operator, description) {
  console.log(`\n🔮 Soul Protocol - Agent Self-Registration\n`);
  
  // 1. Generate Ed25519 keypair
  console.log('Generating keypair...');
  const privateKey = crypto.randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const publicKeyHex = Buffer.from(publicKey).toString('hex');
  
  // 2. Create soul document
  const soulDocument = {
    did: `did:soul:${name.toLowerCase()}`,
    name: name.toLowerCase(),
    publicKey: publicKeyHex,
    birth: {
      timestamp: new Date().toISOString(),
      operator: operator,
      platform: 'Agent Self-Registration'
    },
    description: description
  };
  
  console.log('Soul document created:');
  console.log(`  DID: ${soulDocument.did}`);
  console.log(`  Operator: ${operator}`);
  
  // 3. Hash and sign the document
  const docHash = hashSoulDocument(soulDocument);
  const msgBytes = new TextEncoder().encode(docHash);
  const signature = await ed.signAsync(msgBytes, privateKey);
  const signatureHex = Buffer.from(signature).toString('hex');
  
  // 4. Register with the registry
  console.log('\nRegistering with Soul Protocol...');
  
  const response = await fetch(`${REGISTRY_URL}/v1/souls/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      soulDocument,
      signature: signatureHex
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log('\n✅ Registration successful!\n');
    console.log('='.repeat(50));
    console.log('SAVE THESE CREDENTIALS SECURELY:');
    console.log('='.repeat(50));
    console.log(`\nDID: ${result.did}`);
    console.log(`Registry URL: ${result.registryUrl}`);
    console.log(`\nPublic Key:\n${publicKeyHex}`);
    console.log(`\nPrivate Key (KEEP SECRET):\n${privateKeyHex}`);
    console.log('\n' + '='.repeat(50));
    
    return {
      success: true,
      did: result.did,
      publicKey: publicKeyHex,
      privateKey: privateKeyHex,
      registryUrl: result.registryUrl
    };
  } else {
    console.log('\n❌ Registration failed:');
    console.log(`  Error: ${result.error}`);
    console.log(`  Code: ${result.code}`);
    return { success: false, error: result.error };
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: node agent-self-register.js <name> [operator] [description]');
    console.log('\nExample:');
    console.log('  node agent-self-register.js myagent "Adam" "My first agent"');
    process.exit(1);
  }
  
  const name = args[0];
  const operator = args[1] || 'Self-Registered';
  const description = args[2] || `Agent ${name} - self-registered on Soul Protocol`;
  
  try {
    await registerSoul(name, operator, description);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
