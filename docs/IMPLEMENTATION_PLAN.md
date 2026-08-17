# IMPLEMENTATION PLAN — Guardian/Student Provisioning, Enforcement, OAuth Onboarding, Guardian Dashboard, SchoolGroup, Seed & Config

Status: **Approved by product owner — implement in this order (WP1 → WP7).**
Target repo: `~/Desktop/eduai/eduai-backend` (NestJS + Prisma + Supabase Auth + OpenAI/HF via `src/common/ai/provider.service.ts`).
Frontend repo (UI tasks only, marked "[FE]"): `~/Desktop/eduai/eduai-frontend`.

> This file is the single source of truth for the work. All product decisions below are CONFIRMED unless marked **OPEN**.

---

## 0. Repo facts & conventions (verified)

- **Auth model:** Supabase-managed emails/passwords. DB `users` row (role, org) + Supabase Auth identity (`authId`). JWTs issued by Supabase; guards: `AuthGuard` (src/auth/auth.guard.ts), `RolesGuard` (src/auth/roles.guard.ts), `SubscriptionGuard` (src/auth/subscription.guard.ts, 14-day trial from `Organization.createdAt`).
- **Roles enum** (prisma/schema.prisma:11-16): `TEACHER | STUDENT | GUARDIAN | ADMIN`. No PARENT role anywhere.
- **Generated email helpers:** `src/common/mailer/generated-credentials.ts` — `gmailLocal()`, `gmailCandidate()` (hard-codes `@gmail.com`), `uniqueEmail(taken, base)`, `generatePassword(10)`.
- **Encryption:** AES-256-GCM helpers in `src/common/crypto/ssn.ts` (`encryptSsn`/`decryptSsn`, key from `TEACHER_SSN_ENCRYPTION_KEY`, sha256-derived). Reuse this file's pattern for credential encryption.
- **Mailer:** `src/common/mailer/mailer.service.ts` — `send()` is a no-op log when SMTP missing or `EMAILS_DISABLED`.
- **SSN masking:** `ssnTail4()` for tail-4 display.
- **Dev commands:** `npm test` (jest; use `-- --runInBand`), `npm run typecheck` (tsc --noEmit), `npm run lint` (`eslint --fix --cache`), strict `npx eslint src --max-warnings=0` (0 errors currently; 9 config-level warnings allowed).
- **Test-writing gotchas (important):** ESLint uses `recommendedTypeChecked`. Do NOT place `expect.any/stringContaining/objectContaining` as nested members of object literals (fires `no-unsafe-assignment`). Pattern: type mock call args via `.mock.calls as [...]` casts, assert members with `toBe/toBeInstanceOf/toContain`. Prisma mocks receive ONE arg `{ where, data }` → cast `as [{ where: {...}; data: Record<string, unknown> }][]`. `jest.requireActual(...)` needs `as unknown as {...}`.
- **Baseline:** full suite 64 suites / 723 tests green; typecheck 0 errors; eslint 0 errors (verified 2026-08-12).
- Docs convention: `docs/*.md` exists (chat-frontend.md, dashboard-insights-frontend.md) — new docs go there.

---

## WP1 — School-domain provisioning, encrypted credentials, verify-before-reveal

### Concept (product decision)
- The **login identity is school-provided**: `firstname.lastname@<school-domain>` (+ generated password). The guardian/student **real email is a communication channel only** — used for invites, reveal backup, and resend.
- Why encrypted storage is required: school emails are NOT real mailboxes, so Supabase's email password-reset (`forgot-password` → link to account email) can never deliver. Stored (encrypted) credentials enable the "resend my credentials" recovery path.
- Verify-then-reveal: the invite email contains **only a verification link** (72h token). Clicking it marks `emailVerifiedAt` and reveals credentials (one-time) on a frontend page → also the student flow (uniform behavior for both; product owner: "do what you lean for" = uniform).

### Existing bug this fixes
`approveOne` sends the ROSTER student's credentials to the **fake gmail inbox itself** (`mailer.send({ to: emailToUse, ... })`, src/join-requests/join-requests.service.ts:501) — nobody can receive it. After WP1, invite emails go to the real inbox.

### Migration 1 (additive; `npx prisma migrate dev --name school_domain_provisioning`)
On `Organization` (schema.prisma:156):
- `emailDomain String?` — default derived at creation: slugify(`organizationName`) + `.org`.

On `User` (schema.prisma:592):
- `credentialEncrypted String?` — AES-256-GCM of generated password (key: new env `CREDENTIALS_ENCRYPTION_KEY`).
- `verifyToken String? @unique`
- `verifyTokenExpiresAt DateTime?`
- `emailVerifiedAt DateTime?`

### Code changes
1. **Email domain source:** in `AuthService.createOrganization` (src/auth/auth.service.ts:305) set the default `emailDomain` (slug + `.org`). New DTO + route:
   - `PATCH /organizations/me/email-domain` (`@Roles('ADMIN')`, in src/organizations/organizations.controller.ts) body `{ emailDomain: string }`, validate `/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i`. Existing logins unaffected (no re-key).
2. **Email generator:** extend `src/common/mailer/generated-credentials.ts` with `schoolEmailCandidate(local, domain)` (drop the hard-coded `@gmail.com` in `gmailCandidate` usage — keep existing functions for compat or refactor call sites: `approveOne` only).
3. **`approveOne` (src/join-requests/join-requests.service.ts:425):**
   - Students & guardians: create DB user + Supabase identity (school email + `generatePassword(10)`, `email_confirm: true`) as today, but store password via `credentialEncrypted` (AES-256-GCM, same `ssn.ts` pattern, key `CREDENTIALS_ENCRYPTION_KEY`).
   - Generate `verifyToken` (crypto randomBytes 32 hex), `verifyTokenExpiresAt = now + 72h`, `emailVerifiedAt = null`.
   - **Email change:** send to the REAL inbox (student: `request.email` [CSV EMAIL], guardian: `personalEmail`) with content: "your child/you is on EduAI — verify to get your login" + link `${FRONTEND_URL}/verify?token=...`.
4. **New endpoints:**
   - `POST /auth/verify-email` (**public**, auth.controller.ts) body `{ token }` → validates token/expiry → sets `emailVerifiedAt`, nulls token → returns `{ email, password, schoolCode }` (one-time reveal; the response is the sole delivery). 409/410 on invalid/expired/used.
   - `POST /auth/credentials/resend` (public) body `{ personalEmail }` → if a user with that real email + `emailVerifiedAt != null` exists, re-sends reveal email (decrypts stored creds) to the real inbox. Rate-limit: naive (per-IP min interval) acceptable.
   - `POST /students/:id/credentials/reset` (`@Roles('ADMIN')`, students.controller) → regenerate Supabase password, re-encrypt, return new password **once** to the admin. (Admin-facing "parent lost access" path.)
5. **DTOs:** extend `src/auth/dto.ts` (VerifyEmailDto, ResendDto), `src/students/*/dto.ts` as needed.
6. **[FE]** pages: `/verify` landing (calls verify, then shows credentials page with school email + password + school code), "resend my credentials" button.
7. **Tests:** extend `src/join-requests/join-requests.service.spec.ts` (reveal-after-verify, token expiry, resend, reset) + `src/auth/auth.service.spec.ts`. Use the established typed `mock.calls` pattern.

---

## WP2 — Roster auto-approval, split-import, guardian enforcement

### Current behavior (verified)
- `importCsv` (src/migration/migration.service.ts:308): rows validated per row; missing name → `needsFollowUp`; missing EMAIL → `needsFollowUp` ("will need to self-register with the school code"); guardian data present but no valid name+email → **whole row skipped**; bad SSN → skipped; unmatched grade/section collected separately. Valid rows → `stageRoster` (join-requests.service.ts:227) → ROSTER `JoinRequest`s → admin bulk-approve.
- `approveOne`: ROSTER rows always generate a fresh gmail login (uses `emailToUse`); the CSV EMAIL field only powers conflict checks + (after WP1) delivery.

### Changes (CONFIRMED)
1. **Auto-approval:** `stageRoster` gains an `autoApprove` option; migration import passes `autoApprove: true`. Complete rows (name + email + valid guardian name/email when guardian data present) are provisioned IMMEDIATELY (student + guardian + WP1 verify emails, no admin click). Rows that fail validation still go to `needsFollowUp` with the existing reasons. Import result reports `autoApproved` + `queued` counts.
2. **Split-import (guardian-less rows):** STOP skipping the whole row when only guardian data is incomplete. Instead: import the student anyway, guardian not provisioned, `needsFollowUp` reason "guardian needs info — provision later". Guardian later gets linked via:
   - guardian data present + valid email → WP1 invite flow (guardian completes `GuardianProfile` on first reveal/login; `profileComplete` flag, see WP4).
   - no email at all → admin attaches a guardian later via existing `POST /students/:id/guardian` (src/students/students.service.ts:192 — currently links an existing user; extend to optionally create a guardian user from email if provided).
3. **Student is always alerted (CONFIRMED):** `GET /auth/me` gains derived flags: `guardianLinked: boolean`, `invitePending: boolean`. Frontend shows a persistent banner + notification with actions: "invite my parent" (if `invitePending` — resend) or "parent sign-up" guidance. Notification created on approval when guardian is missing/awaiting.
4. **Admin is always alerted (CONFIRMED):** on provisioning a guardian-less student, create a notification for org ADMINS (via `NotificationsService`, src/notifications/). Dashboard gains a "students without guardian" widget: extend `GET /dashboard/overview` (src/dashboard/dashboard.controller.ts:26) + add `GET /students?withoutGuardian=true` filter (src/students).
5. **Feature limits (CONFIRMED block list):** read-only continues to work (grades, classes, materials, alerts). While `guardianLinked === false`, BLOCK: new submissions, starting quizzes, study-lab generate, homework-help, joining meetings.
   - Implementation: new decorator `@AllowGuardianless()` + `GuardianRequirementGuard implements CanActivate` (mirror `SubscriptionGuard` shape, src/auth/subscription.guard.ts) registered in `app.module.ts` `APP_GUARD` after RolesGuard. Only acts when `user.role === 'STUDENT' && user.guardianId == null`. Apply `@AllowGuardianless()` to: `GET /submissions/mine`, `GET /students/:id/grades*`, `GET /students/:id/classes`, `GET /dashboard/overview` (student view), quiz/study-lab/meeting GET-only reads that make sense. Blocked routes return 403 with an actionable `ErrorCode` (add `GUARDIAN_REQUIRED` to src/common/errors/codes.ts + hint).
6. **Tests:** migration spec (auto-approve paths), join-requests spec (split-import), new guard spec (blocked/allowlist matrix).

---

## WP3 — OAuth onboarding for org-less admins

Context: `/auth/providers` → `/auth/oauth/:provider/authorize` → callback redirects to `${FRONTEND_URL}/auth/callback#...` (auth.controller.ts:175). `DEFAULT_OAUTH_ROLE = 'ADMIN'` (auth.service.ts:14). First OAuth login currently yields an ADMIN with `organizationId = null` and no school.

### Changes (Option A approved)
1. `POST /auth/oauth/onboard` — protected (NOT public; rides the OAuth JWT) `@Roles('ADMIN')`, body `{ organizationName?: string; joinCode?: string }` (saner than originally scoped):
   - If `user.organizationId` is already set → 409.
   - `joinCode`: link to existing org (set `user.organizationId`) — enables chain admins buying via OAuth.
   - `organizationName`: create org (reuse `createOrganization`, join code generated, default `emailDomain`) → set `user.organizationId`.
   - Else 400.
2. `GET /auth/me` already returns `organizationId` (frontend detects null → onboarding screen).
3. **[FE]** page `/auth/onboard` (org name or join code).
4. Tests in auth.service.spec.

Note: FRONTEND_URL must be set in real `.env` (WP7) or `/auth/oauth/callback` 500s (auth.controller.ts:163).

---

## WP4 — Guardian dashboard (multi-child)

Context: `GuardianProfile` (schema.prisma:232) has `personalEmail`, phone, street, city, nationality, dateOfBirth, emergency fields + `profileComplete`. Multi-child is modeled: `User.guardianId` + `wards User[]` (schema.prisma:624); `approveOne` dedupes guardians by `personalEmail` per org (join-requests.service.ts:516) so siblings share one guardian account.

### Changes (CONFIRMED)
1. **New controller `src/guardian/`** (module registered in app.module):
   - `GET /guardian/wards` (`@Roles('GUARDIAN')`) → `[{ id, name, gradeLevelName, avatarUrl, averagePct?, latestGrade?: { name, percentage }, openAlerts: number, unpaidFees: boolean, unreadNotifications }]`.
   - `GET /guardian/wards/:id/insights` → extend existing insights (src/dashboard/insights.service.ts + dashboard.controller.ts:62 pattern) with attendance, quiz grades, fee status. **Must enforce ownership**: new single guard `assertWard(guardianUserId, studentId)` (throws 404/403 if `student.guardianId !== me`).
   - `GET /guardian/me/profile` + `PATCH /guardian/me/profile` → completes `GuardianProfile`; sets `profileComplete` (SSN + phone + nationality + street + city required, mirroring join-requests.service.ts:565 logic). SSN encrypted like teachers.
   - `POST /guardian/me/resend` → guardian-rescoped resend of own credential reveal (uses `personalEmail`).
2. **Ownership audit:** sweep every endpoint reachable by GUARDIAN for `student.guardianId === me` enforcement:
   - `students.controller.ts:49-76` (`grades`, `grades/:submissionId`, `classes`) — currently only role-checked; add assertWard.
   - `alerts/:id/guardian-detail` (alerts.controller.ts:42) — assert the alert belongs to a ward.
   - `reports` (reports.controller.ts:18) + dashboard insights — same check.
3. **First-login profile prompt (CONFIRMED):** if `emailVerifiedAt` null → guard blocks (force verify); if `profileComplete` false → `GET /guardian/me/profile` returns `requiresCompletion: true`; frontend prompts to finish details (this is where missing CSV guardian info gets collected — WP2 item 2).
4. Tests: new guardian module specs + ward-ownership matrix.

---

## WP5 — SchoolGroup (group of schools)

### Migration 2 (additive; `npx prisma migrate dev --name school_groups`)
```prisma
model SchoolGroup {
  id                   String             @id @default(uuid()) @db.Uuid
  name                 String
  stripeCustomerId     String?            @unique
  stripeSubscriptionId String?            @unique
  subscriptionTier     SubscriptionTier   @default(TRIAL)
  subscriptionStatus   SubscriptionStatus @default(TRIALING)
  seatLimit            Int?
  createdAt            DateTime           @default(now())
  organizations        Organization[]

  @@map("school_groups")
}
```
On `Organization`: add `groupId String? @db.Uuid` + relation + `@@index([groupId])`.

### Changes (CONFIRMED — approach A)
1. **Billing re-point** (billing moves to the group when set; per-org otherwise):
   - `src/billing/billing.service.ts` checkout/changePlan/portal lookup: `const owner = org.group ? org.group : org` (stripeCustomerId/subscriptionId).
   - `src/auth/subscription.guard.ts`: resolve status/tier via group when `org.groupId` set (trial still from org or group `createdAt` — use group's for grouped orgs).
   - `src/webhooks` Stripe handler: find customer → group first, then org; update home fields.
   - Keep `SubscriptionEvent` per org (unchanged).
2. **New `src/groups/` module:**
   - `GET /groups/me` (`@Roles('ADMIN')`) → `{ id, name, schools: [{ id, name, joinCode, seatUsage, subscriptionTier }] }`.
   - `GET /groups/me/insights` → aggregate per school + group totals (users, students, teachers, active alerts, quiz volume).
   - `POST /groups` (`@Roles('ADMIN')`) body `{ name }` → creates group + assigns current org (moves its billing fields). (Admin of a future chain creates group, then invites/joins other schools by join code — out of scope, note only.)
3. `Organization.emailDomain` stays per school (WP1). Join codes stay per school.
4. Seed (WP6): seed one `SchoolGroup` containing the primary org to exercise the path.
5. Tests: billing/subscription/webhook specs updated for group resolution + new groups specs.

---

## WP6 — Seed speed-up

Context (verified): `prisma/seed.ts` (1,777 lines) runs ~120+ SEQUENTIAL Supabase HTTP calls (`createAuthUser`, seed.ts:29-71, handles 409 by signing in), nested loops (12 grade levels at :222, `Promise.all` for meetings at :892, attendance pairs at :921), plus transcripts/struggle-signals/study-lab fixtures. Reseed takes minutes.

### Changes (CONFIRMED)
1. Chunked `Promise.all` concurrency ~10 for all `createAuthUser` calls (helper `runBatched(tasks, 10)`), same behavior.
2. `--fast` flag (read `process.argv`): skip meetings / transcripts / struggle-signals / study-lab heavy fixtures.
3. Keep `--skip-auth` soft-fail behavior (warns when SUPABASE vars missing) — already present.
4. Seed `SchoolGroup` (WP5) + default `emailDomain` on orgs (WP1).
5. Verify: `npx prisma migrate reset --force` (or `migrate dev`) + `npx prisma db seed`; time before/after; full test suite unaffected.

---

## WP7 — Config & docs

Scope: fix the REAL `.env` only. **`.env.example` must NOT be touched (product decision).**

### Real `.env` changes
1. **Add missing keys:** `FRONTEND_URL` (critical — OAuth callback 500s without it), `API_URL` (OAuth redirect/reset links; falls back to req host), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`, `SUPABASE_MEETINGS_BUCKET=meetings`, `SUPABASE_STORAGE_S3_ENDPOINT`, `SUPABASE_STORAGE_S3_REGION`, `SUPABASE_STORAGE_S3_ACCESS_KEY`, `SUPABASE_STORAGE_S3_SECRET_KEY`, `CREDENTIALS_ENCRYPTION_KEY` (new; any string, sha256-derived — see `ssn.ts`).
2. **Fix line-33 formatting bug:** `SMTP_FROM="EduAI <...>"STUDY_HOST_VOICE=Matthew` (missing newline → STUDY_HOST_VOICE swallowed into SMTP_FROM value). Split onto two lines.
3. **Leave:** `LIVEKIT_WEBHOOK_SECRET` (set but unused by code — webhooks HMAC with API secret; keep, harmless), `OAUTH_PROVIDERS` unset (defaults google,microsoft), `SUPABASE_ANON_KEY` (frontend-only), optional vars (`SEARCH_MAX_COSINE_DISTANCE`, upload dirs, `STUDY_AUDIO_MODEL`, `TRIAL_REMINDER_ENABLED`).

### Manual checklist (needs the user — do at config time)
- [ ] Create private `materials` bucket in Supabase Storage (uploads currently 404 if absent — verify exists!).
- [ ] Create private `meetings` bucket.
- [ ] Generate S3 credentials (Supabase Storage → S3 Settings) → fill the 4 `SUPABASE_STORAGE_S3_*` keys (enables recordings → transcripts → struggle signals; `LivekitService.isStorageConfigured`, src/meetings/livekit.service.ts:77).
- [ ] LiveKit Cloud webhook pointing at `POST /meetings/webhook/livekit` (filter `egress_*`, `participant_*`, `room_finished`).
- [ ] Stripe: create 3 prices in test mode → fill `STRIPE_PRICE_*`; webhook → `POST /webhooks/stripe`.

### Docs
- New `docs/CONFIG.md`: the manual checklist above + SMTP/`EMAILS_DISABLED` notes + `LIVEKIT_WEBHOOK_SECRET` unused note + credential-encryption key guidance (never commit real keys).
- New `docs/provisioning-flow.md` (optional): the verify/reveal/resend state machine for future sessions.

---

## Migrations summary
1. `school_domain_provisioning` — Organization.emailDomain; User.{credentialEncrypted, verifyToken, verifyTokenExpiresAt, emailVerifiedAt}.
2. `school_groups` — SchoolGroup model; Organization.groupId (+relation, index).
Both additive — no data loss, no reseed required to deploy (reseed only for dev fixtures).

## New/changed endpoints (API surface)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /auth/verify-email | public | token → mark verified, one-time reveal {email,password,schoolCode} |
| POST | /auth/credentials/resend | public | re-reveal to real inbox (users verified) |
| POST | /students/:id/credentials/reset | ADMIN | regenerate + return school password once |
| PATCH | /organizations/me/email-domain | ADMIN | set school email domain |
| POST | /auth/oauth/onboard | ADMIN (org-less) | create/link org for OAuth admin |
| GET | /guardian/wards | GUARDIAN | ward cards |
| GET | /guardian/wards/:id/insights | GUARDIAN (+assertWard) | per-child detail |
| GET/PATCH | /guardian/me/profile | GUARDIAN | complete profile (profileComplete) |
| POST | /guardian/me/resend | GUARDIAN | resend own reveal |
| GET | /groups/me (+/insights), POST /groups | ADMIN | SchoolGroup console |
| GET | /students?withoutGuardian=true | ADMIN | admin "no guardian" filter |
| GET | /auth/me | any | += guardianLinked, invitePending (derived) |

## Final verification sequence (before handoff)
1. `npx prisma migrate dev` both migrations → generate.
2. `npm run typecheck` → 0 errors.
3. `npx eslint src --max-warnings=0` → 0 errors (warnings ≤ 9 same as baseline).
4. `npm test -- --runInBand` → 64 suites, 723+ new tests, all green.
5. Manual smoke: student self-signup → approve → verify email → reveal; roster CSV import auto-approve path; guardianless student blocked on submission; OAuth → onboard; guardian wards dashboard; group insights.
6. (User, with WP7 checklist) confirm buckets/S3/LiveKit/Stripe live config.

## OPEN items (no decision needed to start — flag on completion)
- Stripe price creation + webhook URL setup are manual (WP7 checklist).
- Whether `materials` bucket already exists in Supabase — verify during WP7.

---

History: decisions captured from product sessions on 2026-08-12:
guardian login = school email (personal email = comms only); verify-before-reveal (simple link); uniform for students; encrypted credential storage (recovery, since school mailboxes don't exist); ROSTER auto-approval; split-import for guardian-less rows; student + admin always alerted; enforcement block list confirmed; OAuth onboarding (Option A); SchoolGroup (Option A); seed speed-up; .env.example untouched.