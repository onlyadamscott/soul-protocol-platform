import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { randomBytes } from 'crypto';

// Configure ed25519 to use sha512
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ============================================
// Cryptographic Utilities
// ============================================

/**
 * Generate a random nonce for challenges
 */
export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a unique challenge ID
 */
export function generateChallengeId(): string {
  return `ch_${randomBytes(16).toString('hex')}`;
}

/**
 * Verify an Ed25519 signature
 */
export async function verifySignature(
  message: string | Uint8Array,
  signature: string,
  publicKey: string
): Promise<boolean> {
  try {
    const msgBytes = typeof message === 'string' 
      ? new TextEncoder().encode(message)
      : message;
    
    // Handle different signature formats
    const sigBytes = decodeBase58OrHex(signature);
    const pubKeyBytes = decodeBase58OrHex(publicKey);
    
    return await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Hash a soul document for signing
 */
export function hashSoulDocument(doc: object): string {
  const canonical = JSON.stringify(doc, Object.keys(doc).sort());
  const hash = sha512(new TextEncoder().encode(canonical));
  return Buffer.from(hash).toString('hex');
}

/**
 * Decode base58 or hex string to bytes
 */
function decodeBase58OrHex(input: string): Uint8Array {
  // Remove common prefixes
  if (input.startsWith('z')) {
    input = input.slice(1);
  }
  if (input.startsWith('0x')) {
    input = input.slice(2);
  }
  
  // Try hex first (most common)
  if (/^[0-9a-fA-F]+$/.test(input)) {
    return Buffer.from(input, 'hex');
  }
  
  // Try base58
  return base58Decode(input);
}

/**
 * Simple base58 decoder
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base58 character: ${char}`);
    
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  
  // Handle leading zeros
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  
  return new Uint8Array(bytes.reverse());
}
