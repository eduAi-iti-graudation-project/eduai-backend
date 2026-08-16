# Backend Specs (supplement to specs.md)

Read `specs.md` first — this file only covers what's local to this repo.

## Stack
NestJS · Prisma · Postgres+pgvector (via Supabase) · Zod (`nestjs-zod`) ·
Supabase Auth · HuggingFace embeddings (1024-dim) · Custom LLM provider
(ITI API gateway) · Supabase Storage · Jest + Supertest.

## Folder structure — one module per bounded concern, matching specs.md §3

```
src/
  auth/            # Supabase auth guard, role decorator, session handling
  classes/         # Class, Enrollment
  rubrics/         # Rubric, RubricCriterion, Prompt Factory (PDF import)
  assignments/
  dashboard/       # Unified GET /dashboard/overview — role-aware aggregation
  submissions/     # Submission, SubmissionChunk, status state machine
  grading/         # Grading Agent: retrieval + LLM call + citation
  analysis/        # Analysis Agent: threshold rule + explanation LLM call
                    # Criterion Detector + Report Generator
  assistant/       # Assistant Agent: tool-calling loop
  alerts/          # CRUD, resolve/dismiss endpoint PATCH /alerts/:id
  notifications/   # Notification model, email (nodemailer), push infra stored
  reports/         # Three-tier report generation (auto-triggered on alert)
  materials/       # ClassMaterial, MaterialChunk, curriculum chunking
  common/
    llm/           # Single LlmService — all agents call through this,
                    # never the SDK directly
    pii/           # Redaction middleware
    storage/       # Supabase Storage service (upload, get URL)
    validation/    # Shared Zod schemas + retry-once wrapper
  prisma/          # PrismaService (injectable wrapper), migrations/
```

Each feature module = `*.module.ts`, `*.controller.ts`, `*.service.ts`,
`dto/` (Zod schemas). **Controllers stay thin** — routing, DTO validation,
calling one service method, returning. All business logic lives in services.
No Prisma calls inside a controller, ever.

## Conventions the agent must follow

- **Dependency injection, not manual instantiation.** If a service needs
  another service, inject it via the constructor — don't `new` it.
- **One `PrismaService`, injected everywhere.** Don't create a second
  Prisma client instance anywhere in the codebase.
- **Repository-style isolation for vector queries.** Since Prisma can't
  express `<->` similarity search, isolate every raw SQL call
  (`$queryRaw`) inside a dedicated method on the relevant service (e.g.
  `RubricsService.findSimilarCriteria(...)`) — never inline raw SQL in a
  controller or in more than one place per concern.
- **Guards for auth, not manual checks.** Role/ownership checks (e.g. "a
  teacher can only see their own class") belong in a NestJS Guard, applied
  via decorator, not as an `if` at the top of a service method.
- **Exceptions via NestJS's built-in exception classes**
  (`NotFoundException`, `BadRequestException`, etc.), caught by a global
  exception filter — don't hand-roll error responses per-endpoint.
- **DTOs for every request and response body**, validated with Zod via
  `nestjs-zod`. Never trust `req.body` shape without validation.
- **All LLM calls go through `common/llm/LlmService`.** Never call the
  LLM provider directly from a feature module — this is what makes the
  Zod-validate-and-retry pattern (specs.md §4) and PII redaction
  consistent across every agent instead of reimplemented five times.

## Environment

`.env` (gitignored): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`CUSTOM_PROVIDER_BASE_URL`, `HF_TOKEN`. Real values live only in deployed
environments — never committed, never hardcoded, never logged.

## WP5 — School Groups & billing (non-negotiable rules)

A "school group" (`SchoolGroup`) lets multiple schools share one billing
owner. The rules below are enforced in code and mirrored by webhooks; a
violation is a bug.

- **Groups are Enterprise-only.** Any billing write — checkout
  (`BillingService.createCheckoutSession`), plan change
  (`changePlan`), or a Stripe webhook — for a grouped school
  (`Organization.groupId` set) must target the `enterprise` plan, or it is
  rejected/ignored. Enforced via `assertGroupAllowsPlan` (throws 403
  `GROUP_REQUIRES_ENTERPRISE`) and in `WebhooksService` (non-Enterprise
  checkout/subscription events for a group return `ignored: true`).
- **Groups have unlimited seats.** When the billing home is a `SchoolGroup`,
  `seatLimit` is written/read as `null`. Seat *usage* is still counted across
  every school in the group (`countGroupSeats`).
- **Billing home is the group, not the school.** When grouped, Stripe
  customer/subscription live on the `SchoolGroup` row; the school's own
  `stripeCustomerId`/`stripeSubscriptionId` are nulled. Checkout sessions
  carry `groupId` in metadata so webhooks write to the group without a
  customer lookup. `GET /billing/me` and `GET /organizations/me` reflect the
  group's subscription and expose `seatLimit: null` and an Enterprise-only
  `availablePlans` catalog.
- **Create group → forced Enterprise.** `POST /groups` moves the school's
  Stripe customer/subscription onto the new group, sets tier `ENTERPRISE`
  + `seatLimit null`, and either upgrades the existing subscription to the
  Enterprise price in Stripe (`action: "UPGRADED"`) or, if the school had no
  subscription, returns `requiresCheckout: true` for the frontend to run an
  Enterprise checkout.
- **Join by code.** `POST /groups/join` (`{ joinCode }`, unique, generated as
  8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) attaches the school to the
  group, cancels the school's own Stripe subscription at period end
  (`cancel_at_period_end: true`), nulls its Stripe/billing fields, and resets
  it to `TRIALING`/`TRIAL`. Joining/creating when already grouped throws
  `GROUP_ALREADY_MEMBER` (409); unknown codes throw `GROUP_NOT_FOUND` (404).
- **Guard integration.** `SubscriptionGuard` reads `organization.group ??
  organization`, so a grouped school is already subject to the group's
  subscription status/trial window.

## API contract — how the frontend knows what exists

The backend is the single source of truth for the API shape, generated
automatically from the same Zod DTOs used for validation — never
hand-maintained separately.

1. Install `@nestjs/swagger` alongside `nestjs-zod`. In `main.ts`, apply
   nestjs-zod's Swagger patch (check `nestjs-zod`'s OpenAPI docs for the
   current function name/import — this has moved between package versions,
   confirm before wiring it up) *before* calling `SwaggerModule.createDocument`.
2. Every controller response should use `@ApiOkResponse({ type: X.Output })`
   (or the current `nestjs-zod` equivalent) so response shapes — not just
   request bodies — show up in the generated document, not only inputs.
3. Serve the raw OpenAPI JSON at a fixed path (NestJS/Swagger's default is
   `/api-json` once `SwaggerModule.setup('api', app, document)` is called).
   This endpoint must exist in every deployed environment, not just local
   dev — the frontend pulls its types from the *deployed* backend.
4. Whenever a DTO changes, the document changes automatically on next
   deploy. Nobody manually edits an API contract file.

## Definition of done, for any endpoint change
Add or update the `@ApiOkResponse`/`@ApiBody` annotations so the OpenAPI
document reflects the change — an endpoint isn't "done" if it works but
isn't visible in `/api-json`, since that silently breaks the frontend's
type generation.

## Local dev

`docker compose up -d` (Postgres+pgvector) → `npx prisma migrate dev` →
`npx prisma db seed` → `npm run start:dev`. If this sequence changes,
update this section — an agent following a stale setup section will waste
a session debugging an environment that no longer matches reality.

