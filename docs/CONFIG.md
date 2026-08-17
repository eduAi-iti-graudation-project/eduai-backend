# Configuration Guide

How to configure the EduAI backend for local development and production.

## Quick start

```bash
cp .env.example .env   # if starting fresh — the dev .env is filled already for local dev
npm install
npx prisma migrate dev
npx prisma db seed     # or: npx tsx prisma/seed.ts --fast
npm run start:dev
```

> **Note on `.env.example`:** by product decision, `.env.example` is intentionally
> not kept in sync with the running dev `.env` (it never contains real secrets).

## Manual checklist (one-time, per environment)

- [ ] Create a private `materials` bucket in Supabase Storage (uploads 404 if absent — verify it exists).
- [ ] Create a private `meetings` bucket (S3-compatible egress destination).
- [ ] Generate S3 credentials (Supabase Storage → S3 Settings) and fill the 4
      `SUPABASE_STORAGE_S3_*` keys. These power recordings → transcripts →
      struggle signals (`LivekitService.isStorageConfigured`).
- [ ] LiveKit Cloud webhook → `POST /meetings/webhook/livekit` (filter
      `egress_*`, `participant_*`, `room_finished`).
- [ ] Stripe: create 3 test-mode prices → fill `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`,
      `STRIPE_PRICE_ENTERPRISE`; set `STRIPE_SECRET_KEY`; webhook → `POST /webhooks/stripe`.

## Key variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | ✅ | Server-side admin client |
| `SUPABASE_ANON_KEY` | frontend-only | Not read by the backend |
| `FRONTEND_URL` | ✅ | OAuth callback + verify/reset links **500s without it** |
| `API_URL` | ✅ | OAuth redirect/reset links (falls back to request host) |
| `CREDENTIALS_ENCRYPTION_KEY` | ✅ | Encrypts school-provisioned student/guardian passwords (AES-256-GCM, any string, sha256-derived). Missing ⇒ "Credential encryption is not configured on this server." Never commit a real key. |
| `SMTP_*` | for emails | `EMAILS_DISABLED=1` disables sending. Gmail: app password, not the account password. |
| `LIVEKIT_WEBHOOK_SECRET` | optional | Set but **unused** by code — LiveKit webhooks HMAC with the API secret. Harmless to keep. |
| `OAUTH_PROVIDERS` | optional | Defaults to `google,microsoft` when unset |
| `STRIPE_*` | for billing | See manual checklist |
| `SUPABASE_MEETINGS_BUCKET` | for recordings | Set to `meetings` |

## Seed

```bash
npx prisma db seed                   # full demo fixtures (~minutes, Supabase-bound)
npx tsx prisma/seed.ts --fast        # skip attendance + submission fixtures
```

Seed creates a demo `SchoolGroup` (billing home for the demo org) and sets the
org's `emailDomain` to `demo.org`.

## Credential encryption

- Key: `CREDENTIALS_ENCRYPTION_KEY` (any string; sha256-derived exactly like the
  SSN key in `src/common/crypto/ssn.ts`).
- Rotating the key invalidates previously stored credentials (no re-key support
  yet) — pick a stable key per environment.