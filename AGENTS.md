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

## Current sprint — End-to-end pipeline + notifications + reports + dashboard

### Pipeline (in execution order)

1. **Teacher creates assignment + rubric** — manual form or PDF import → AI
   extracts criteria (Prompt Factory) → teacher reviews/edits → confirms
2. **On rubric confirm** → each criterion's `description` embedded (1024 dim)
   via HuggingFace `mxbai-embed-large-v1` stored in `RubricCriteria.embedding`
3. **Student submits** — text paste or PDF upload → raw text chunked
   (~300-500 tokens, paragraph-aware, ~50 token overlap) → `SubmissionChunk`
   rows created
4. **Auto-grade fires** (fire-and-forget inside
   `SubmissionsService.create()`) → `GradingService.gradeSubmission()` runs
   synchronously in background, status `SUBMITTED → GRADING_IN_PROGRESS →
   REVIEW_READY` → teacher notified via email
5. **Teacher reviews** — opens submission, sees per-criterion AI scores +
   feedback, edits any points/notes
6. **Teacher confirms all** — `PATCH /grades/confirm-all/:submissionId`
   atomically sets all `GradingScore.isConfirmed = true`, status →
   `CONFIRMED`
7. **On confirm** → `AnalysisService.evaluateStudent()` runs threshold check
   → if flagged, `Alert` created → `ReportService.generate()` auto-creates
   three-tier report (parent/teacher/management) via single LLM call →
   `NotificationService` emails relevant parties

### Modules

| Module | Role |
|---|---|
| `auth/` | Supabase JWT guard, role guard, `@Roles()` decorator |
| `guardians/` | Guardian-student linking, parent dashboard data |
| `attendance/` | Import + view endpoints |
| `analysis/` | Existing overall-grade Analysis Agent + `criterion-detector.ts` + `report-generator.ts` |
| `notifications/` | NotificationService (email + push), Notification model |
| `materials/` | Supabase Storage integration for original file preservation |
| `dashboard/` | Unified `GET /dashboard/overview` — role-aware aggregation |
| `rubrics/` | CRUD, PDF import (Prompt Factory), confirm + embed criteria |
| `common/llm/` | Single `LlmService` wrapping OpenAI SDK — all agents call through this |
| `common/pii/` | Redact student name/ID before any LLM call |
| `common/chunker/` | Shared `chunkText()` — paragraph-aware, configurable token window |
| `submissions/` | Student submit, chunking, auto-trigger grading via fire-and-forget |
| `grading/` | Grading Agent + `confirmAll()` bulk endpoint |
| `analysis/` | Deterministic threshold rule + alert creation |
| `reports/` | Three-tier report generation (triggered on alert creation) |
| `notifications/` | Email delivery (nodemailer), `Notification` model, push infra stored |
| `assistant/` | Tool-calling loop (search_curriculum, create_quiz) |
| `alerts/` | CRUD including `PATCH /alerts/:id` (resolve/dismiss) |
| `materials/` | `ClassMaterial`, `MaterialChunk`, curriculum chunking + search |
| `dashboard/` | Unified `GET /dashboard/overview` — role-aware aggregation |
| `common/validation/` | Shared Zod schemas + retry-once wrapper for LLM structured output |

### Schema additions

- `UserRole` enum: `TEACHER`, `STUDENT`, `GUARDIAN`, `ADMIN`
- `Notification { id, userId, type, channel (EMAIL\|PUSH), title, body, readAt?, createdAt }`
- `StudentReport { id, studentId, alertId, parentSection, teacherSection, managementSection, createdAt }`
- `DeviceToken { id, userId, token, platform, createdAt }`
- `Attendance { id, studentId, classId, date, status (PRESENT\|ABSENT\|LATE\|EXCUSED), createdAt }`

### Key decisions

- Auto-grade is fire-and-forget: `SubmissionsService.create()` calls
  `gradingService.gradeSubmission(id)` without `await`. Student gets instant
  response, grading runs in background, teacher notified on completion.
- Student never sees AI grades — only the teacher sees them during review.
  Confirmed grades are visible to students via `GET /students/:id/grades`.
- Reports auto-trigger on alert creation — no manual gate in MVP.
- All 4 roles have separate dashboard views via `GET /dashboard/overview`.
- Auth uses placeholder UUID; teammate wires Supabase Auth later.

### Status

| # | What | Status |
|---|---|---|
| 1 | Auto-grade on Submit (fire-and-forget) | ⬜ Not started |
| 2 | Notification Service (nodemailer + model) | ⬜ Not started |
| 3 | Alert resolution endpoint PATCH /alerts/:id | ⬜ Not started |
| 4 | Three-tier Report generation | ⬜ Not started |
| 5 | Bulk confirm endpoint PATCH /grades/confirm-all/:submissionId | ⬜ Not started |
| 6 | Prisma schema: GUARDIAN/ADMIN roles + new models | ⬜ Not started |
| 7 | Role guards for GUARDIAN + ADMIN | ⬜ Not started |

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
