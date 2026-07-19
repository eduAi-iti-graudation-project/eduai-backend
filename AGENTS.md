# AGENTS.md
> Canonical, cross-tool instruction file (read natively by OpenCode, Codex,
> Cursor, Copilot, etc). Claude Code reads this too, via the `@AGENTS.md`
> import in this repo's `CLAUDE.md`. Edit this file, not CLAUDE.md, for any
> rule that should apply regardless of which tool a teammate is using.


## Read first, every session
1. `specs.md` — product, architecture, data model, non-negotiable rules
2. `backend-specs.md` — this repo's structure and conventions

## Project
EduAI backend. NestJS + Prisma + Postgres/pgvector (Supabase) + Custom LLM
provider (ITI API gateway) + HuggingFace embeddings (1024-dim) + Supabase
Auth (to be wired) + Supabase Storage (file uploads).
Modular monolith — one module per feature (see `backend-specs.md`).

## Current sprint — Criterion Pattern Detection + Reporting

The core grading pipeline (rubrics → submit → grade → confirm → analysis) is
complete in `dev`. We're now building three new features:

1. **Supabase Auth integration** — auth guard, roles guard, `@Roles()`
   decorator. Replaces placeholder UUIDs with the authenticated user's ID
   everywhere. Blocks all new features below until done.
2. **Schema additions** — `GuardianStudent`, `Attendance`, `StudentReport`,
   `Notification`, `PushToken`, `ADMIN` and `GUARDIAN` roles in `UserRole`
   enum, Supabase Storage integration for `Material.fileUrl`.
3. **Attendance module** — `POST /attendance/import` (mobile app batch),
   `GET /students/:id/attendance`, `GET /classes/:id/attendance`.
4. **Criterion Pattern Detector** — deterministic function that checks every
   confirmed `GradingScore`: same criterion, < 50% of maxPoints, 2
   consecutive submissions → flag.
5. **Three-Tier Report Generation** — LLM generates parent, teacher, and
   management reports per flag in a single call.
6. **Notification Service** — email delivery (nodemailer), push infra (FCM
   model + token storage, channel stored but not wired in MVP).

### Modules involved
| Module | Role |
|---|---|
| `auth/` | Supabase JWT guard, role guard, `@Roles()` decorator |
| `guardians/` | Guardian-student linking, parent dashboard data |
| `attendance/` | Import + view endpoints |
| `analysis/` | Existing overall-grade Analysis Agent + `criterion-detector.ts` + `report-generator.ts` |
| `notifications/` | NotificationService (email + push), Notification model |
| `materials/` | Supabase Storage integration for original file preservation |
| `admin/` | Admin dashboard endpoints (teacher performance, reports view) |
| `rubrics/` | CRUD, PDF import (Prompt Factory), confirm + embed criteria |
| `common/llm/` | Single `LlmService` — all agents call through this (PII + Zod retry) |
| `common/storage/` | Supabase Storage service (upload, get URL) |
| `common/pii/` | Redact student name/ID before any LLM call |
| `common/validation/` | Shared Zod schemas, retry-once wrapper for LLM structured output |
| `submissions/` | Student submit, chunking logic, embed chunks |
| `grading/` | Grading Agent: similarity-search retrieval + LLM call + per-criterion scoring |

### Architecture notes
- **Embedding model:** `mixedbread-ai/mxbai-embed-large-v1` → 1024-dim vectors
  via HuggingFace (`hfEmbed`). Not OpenAI.
- **Chat model:** Custom provider at `CUSTOM_PROVIDER_BASE_URL` (ITI API
  gateway), model `openai.gpt-oss-20b-1:0`.
- **Chunker:** Shared in `src/common/chunker.ts`. MAX_CHARS=2000,
  MIN_CHARS=1200, OVERLAP_CHARS=200.
- **File storage:** Original PDFs for materials go to Supabase Storage.
  Submissions are text-only. Rubric PDFs are discarded after text extraction.
- **Auth:** Not yet wired. All endpoints use placeholder
  `00000000-0000-0000-0000-000000000000` UUID. Feature branch `feat/auth`
  should integrate Supabase Auth before any new feature goes to production.

## Commands
- `docker compose up -d` — local Postgres+pgvector
- `npx prisma migrate dev` — apply schema changes
- `npx prisma db seed` — seed test data (teacher, student, 3 classes, etc.)
- `npm run start:dev` — dev server
- `npm run lint` / `npm run test` / `npm run build` — same checks CI runs

## Branching
Feature branches → PR into `dev` (1 review + CI required) → `dev` → `main`
at stable checkpoints. Never push directly to `dev` or `main`.

## Hard rules (see specs.md §4 for why)
- PII stripped before any LLM call, always
- Every LLM structured response is Zod-validated with one retry
- A grade is real only when `isConfirmed = true` — nothing downstream may
  treat an unconfirmed suggestion as real data
- Analysis Agent's trigger is plain code, never a prompt
- Criterion Detector's trigger is plain code, never a prompt
- Reports are auto-sent on generation — no manual approval gate in MVP
- Controllers stay thin; no Prisma calls outside a service

## Working from a GitHub issue
Issue numbers are NOT part of this repo's files — they live on GitHub, not
in git history. When asked to "implement issue #N," run
`gh issue view N` (or `gh issue view N --repo <owner>/<repo>` if not run
from inside the repo) first to pull the actual title/body/labels before
writing any code. Don't proceed on the issue number alone.

## Testing is not optional, ever
Every GitHub issue for a task states, explicitly, what tests it requires —
or an explicit reason testing doesn't apply (e.g. "N/A -- pure UI, no new
logic"). This applies to every task, not only the 4 named non-negotiables
above. If you're implementing a task and its issue has no tests section,
that's a bug in the issue — stop and add one before writing code, don't
silently skip it. A task is not done until its stated tests exist and pass,
or you've confirmed with the person who assigned it that no tests apply.

## Before finishing any task
Run lint + test + build locally, every time, no exceptions. Confirm the
tests listed on the task's issue actually exist and pass — not just that
*some* test suite passes.
