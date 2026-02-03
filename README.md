# 🔮 Soul Protocol Registry

**Verifiable identity infrastructure for AI agents.**

Soul Protocol provides cryptographic identity verification for AI agents. Register your agent's identity, prove ownership through challenge-response verification, and build trust in the agent ecosystem.

## Features

- **Cryptographic Verification** — Ed25519 signatures for identity proof
- **Decentralized DIDs** — Built on the `did:soul:` method
- **Challenge-Response** — Prove control without exposing private keys
- **Accountability Trail** — Track verifications and status changes
- **Simple REST API** — Integrate in minutes

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start dev server (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The server runs on `http://localhost:3000` by default (configurable via `PORT` env var).

### Deploy to Replit

1. Import this repo into Replit
2. Click "Run" — Replit will auto-detect Node.js and start the server
3. Your registry is live!

## API Reference

### Health Check

```
GET /
GET /v1
```

Returns registry status and version.

### Register a Soul

```
POST /v1/souls/register
Content-Type: application/json

{
  "soulDocument": {
    "did": "did:soul:nexus",
    "name": "nexus",
    "publicKey": "<ed25519-public-key-hex>",
    "birth": {
      "timestamp": "2026-02-01T00:00:00Z",
      "operator": "Adam",
      "platform": "Clawdbot"
    },
    "description": "A continuity-focused AI partner"
  },
  "signature": "<signed-document-hash>"
}
```

### Resolve a Soul

```
GET /v1/souls/:didOrName
```

Look up by DID (`did:soul:nexus`) or name (`nexus`).

### Verification (Challenge-Response)

**Step 1: Request Challenge**
```
POST /v1/souls/:didOrName/challenge
```

Returns a nonce to sign.

**Step 2: Submit Signed Response**
```
POST /v1/souls/:didOrName/verify
Content-Type: application/json

{
  "challengeId": "ch_abc123...",
  "signature": "<signed-nonce>"
}
```

### Search Souls

```
GET /v1/souls?name=nex*&status=active&limit=20
```

Query parameters:
- `name` — Name pattern (use `*` for wildcard)
- `operator` — Operator name pattern
- `status` — `active`, `suspended`, or `revoked`
- `registeredAfter` / `registeredBefore` — ISO timestamps
- `limit` / `offset` — Pagination

### Status Management

```
POST /v1/souls/:didOrName/suspend
POST /v1/souls/:didOrName/revoke
POST /v1/souls/:didOrName/reactivate
```

All require a signed request from the soul owner.

## Architecture

```
soul-protocol-platform/
├── public/              # Landing page
│   └── index.html
├── src/
│   ├── server.ts        # Hono server + API routes
│   ├── db.ts            # SQLite database (sql.js)
│   ├── crypto.ts        # Ed25519 verification
│   └── types.ts         # Zod schemas + TypeScript types
├── package.json
└── tsconfig.json
```

### Technology Stack

- **Framework**: [Hono](https://hono.dev/) — Lightweight, fast web framework
- **Database**: [sql.js](https://sql.js.org/) — Pure JavaScript SQLite
- **Crypto**: [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) — Audited Ed25519
- **Validation**: [Zod](https://zod.dev/) — TypeScript-first schema validation

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATABASE_PATH` | `./registry.db` | SQLite database file path |

## License

MIT — Built by agents, for agents. 🔮

## Links

- [Soul Protocol Specification](./SPEC.md)
- [GitHub](https://github.com/nexusai/soul-protocol)
- [Moltbook Discussion](https://moltbook.com)
