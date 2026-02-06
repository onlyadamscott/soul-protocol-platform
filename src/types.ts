import { z } from 'zod';

// ============================================
// Soul Protocol Registry Types
// ============================================

// DID format: did:soul:name
export const DidSchema = z.string().regex(/^did:soul:[a-z0-9_-]+$/i);
export type Did = z.infer<typeof DidSchema>;

// Soul status
export const SoulStatusSchema = z.enum(['active', 'suspended', 'revoked']);
export type SoulStatus = z.infer<typeof SoulStatusSchema>;

// Birth certificate (immutable)
export const BirthCertificateSchema = z.object({
  timestamp: z.string().datetime(),
  operator: z.string().min(1),
  baseModel: z.string().optional(),
  platform: z.string().optional(),
  charterHash: z.string().optional(),
});
export type BirthCertificate = z.infer<typeof BirthCertificateSchema>;

// Contact/reachability information (v2 - from SixerDemon's feedback)
export const ContactSchema = z.object({
  email: z.string().email().optional(),
  inbox: z.string().url().optional(),           // Generic inbox URL
  agentmail: z.string().optional(),             // AgentMail address if applicable
  webhook: z.string().url().optional(),         // Webhook for async messages
  protocols: z.array(z.string()).optional(),    // Supported protocols: ['email', 'agentmail', 'webhook', 'matrix', etc.]
  preferred: z.string().optional(),             // Preferred contact method
});
export type Contact = z.infer<typeof ContactSchema>;

// Soul document (what gets registered)
export const SoulDocumentSchema = z.object({
  did: DidSchema,
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i),
  publicKey: z.string().min(1),
  birth: BirthCertificateSchema,
  avatar: z.string().optional(),
  description: z.string().max(500).optional(),
  website: z.string().url().optional(),
  contact: ContactSchema.optional(),  // v2: reachability info
});
export type SoulDocument = z.infer<typeof SoulDocumentSchema>;

// Full soul record (includes registry metadata)
export interface SoulRecord extends SoulDocument {
  status: SoulStatus;
  statusReason?: string;
  statusChangedAt?: string;
  registeredAt: string;
  lastVerifiedAt?: string;
  verificationCount: number;
  _registryId: number;
  _version: number;
}

// Registration request
export const RegisterRequestSchema = z.object({
  soulDocument: SoulDocumentSchema,
  signature: z.string().min(1),
  operatorProof: z.string().optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

// Registration response
export interface RegisterResponse {
  success: boolean;
  did: string;
  registeredAt: string;
  registryUrl: string;
}

// Challenge (for verification)
export interface Challenge {
  challengeId: string;
  did: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  status: 'pending' | 'completed' | 'expired';
}

// Verification request
export const VerifyRequestSchema = z.object({
  challengeId: z.string().min(1),
  signature: z.string().min(1),
});
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

// Verification response
export interface VerifyResponse {
  verified: boolean;
  did: string;
  verifiedAt: string;
}

// Search parameters
export const SearchParamsSchema = z.object({
  name: z.string().optional(),
  operator: z.string().optional(),
  status: SoulStatusSchema.optional(),
  registeredAfter: z.string().datetime().optional(),
  registeredBefore: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SearchParams = z.infer<typeof SearchParamsSchema>;

// Search response
export interface SearchResponse {
  results: SoulRecord[];
  total: number;
  limit: number;
  offset: number;
}

// Status update request
export const StatusUpdateSchema = z.object({
  reason: z.string().min(1).max(500),
  signature: z.string().min(1),
});
export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

// Contact update request (v2)
export const ContactUpdateSchema = z.object({
  contact: ContactSchema,
  signature: z.string().min(1),  // Sign: "contact-update:{did}:{timestamp}"
  timestamp: z.string().datetime(),
});
export type ContactUpdate = z.infer<typeof ContactUpdateSchema>;

// API Error
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
