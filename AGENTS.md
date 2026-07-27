# AGENTS.md
> Canonical, cross-tool instruction file (read natively by OpenCode, Codex,
> Cursor, Copilot, etc). Claude Code reads this too, via the `@AGENTS.md`
> import in this repo's `CLAUDE.md`. Edit this file, not CLAUDE.md, for any
> rule that should apply regardless of which tool a teammate is using.


## Read first, every session
1. `specs.md` — product, architecture, data model, non-negotiable rules
2. `backend-specs.md` — this repo's structure and conventions

## Exploring the codebase
When asked about an endpoint:
1. Try `curl http://localhost:3000/api` or
   `curl http://localhost:3000/api-json` first to check the OpenAPI docs.
2. If the server isn't running, try `npm run start:dev` and retry. If you
   can't start it, say so.
3. If the endpoint isn't in the OpenAPI docs, read the relevant module's
   controller and service code.

## Project
EduAI backend. NestJS + Prisma + Postgres/pgvector (Supabase) + Custom LLM
provider (ITI API gateway) + HuggingFace embeddings (1024-dim) + Supabase
Auth + Supabase Storage.
Modular monolith — one module per feature (see `backend-specs.md`).

## Phases — Mastra agent buildout

### Phase 1: Feedback Writer Agent
Replace the placeholder `aiFeedback` (`"Auto-graded placeholder..."`) in
`GradingService.gradeSubmission()` with real per-criterion natural-language
feedback written by a Mastra agent.

**Trigger:** Fires after `gradeSubmission()` upserts scores — calls
`FeedbackWriterService.write(submissionId)`.

**Flow:**
1. Reads submission chunks + rubric criteria + per-criterion scores
2. For each criterion, calls `LlmService` via a Mastra agent tool to
   generate specific, actionable feedback (e.g. *"Your thesis was clear
   but needs textual evidence — try citing line 12."*)
3. Saves feedback to `GradingScore.aiFeedback`

**Files to create:**
```
src/feedback-writer/
  feedback-writer.module.ts
  feedback-writer.service.ts
  feedback-writer.agent.ts     ← Mastra Agent definition
  tools/write-feedback.tool.ts ← createTool calling LlmService
```
**Depends on:** `@mastra/core` + `@mastra/nestjs` wired into the project.

### Phase 2: Homework Helper Agent
A student-facing agent that answers homework questions by searching the
curriculum, looking up assignments, and giving hints.

**Endpoint:** `POST /assistant/homework-help`

**Flow:**
1. Student sends "I don't get question 3 on the math assignment"
2. Agent searches curriculum (tool 1 — via `MaterialsService`)
3. Agent looks up assignment + rubric context (tool 2)
4. Agent decides: give a hint, explain a concept, or redirect to teacher
5. Responds to student + logs the interaction (tool 3)

**Files to create:**
```
src/homework-helper/
  homework-helper.module.ts
  homework-helper.controller.ts
  homework-helper.service.ts
  homework-helper.agent.ts
  tools/search-curriculum.tool.ts
  tools/lookup-assignment.tool.ts
  tools/log-interaction.tool.ts
```
**Depends on:** Phase 1 complete (Mastra already wired), frontend team
for the student-side UI.

## Remaining architecture

### Key decisions
- Auto-grade is fire-and-forget: `SubmissionsService.create()` calls
  `gradingService.gradeSubmission(id)` without `await`. Student gets instant
  response, grading runs in background, teacher notified on completion.
- Student never sees AI grades — only the teacher sees them during review.
  Confirmed grades are visible to students via `GET /students/:id/grades`.
- Reports auto-trigger on alert creation — no manual gate in MVP.
- All 4 roles have separate dashboard views via `GET /dashboard/overview`.
- Auth uses placeholder UUID; teammate wires Supabase Auth later.

### Modules

| Module | Role |
|---|---|
| `auth/` | Supabase JWT guard, role guard, `@Roles()` decorator |
| `guardians/` | Guardian-student linking, parent dashboard data |
| `attendance/` | Import + view endpoints |
| `analysis/` | Threshold rule + alert creation + report generation |
| `notifications/` | NotificationService (email via nodemailer) |
| `materials/` | ClassMaterial, MaterialChunk, curriculum chunking + search |
| `dashboard/` | Unified `GET /dashboard/overview` — role-aware aggregation |
| `rubrics/` | CRUD, PDF import (Prompt Factory), confirm + embed criteria |
| `submissions/` | Student submit, chunking, auto-trigger grading |
| `grading/` | Grading Agent + `confirmAll()` bulk endpoint |
| `reports/` | Three-tier report generation |
| `assistant/` | Tool-calling loop (search_curriculum, create_quiz) |
| `alerts/` | CRUD including `PATCH /alerts/:id` (resolve/dismiss) |
| `classes/` | Class + Enrollment (self-serve + teacher approve/reject) |
| `enrollments/` | `PATCH /enrollments/:id/approve|reject` |
| `grades/` | Grade CRUD, class linking |
| `teachers/` | Teacher-grade assignment |
| `users/` | Admin `GET /users?role=&q=` |
| `students/` | Student classes, update, link guardian |
| `feedback-writer/` | **Phase 1** — Mastra agent for per-criterion feedback |
| `homework-helper/` | **Phase 2** — Mastra agent for student homework help |
| `common/llm/` | `LlmService` — all LLM calls go through this |
| `common/pii/` | Redact student name/ID before any LLM call |
| `common/chunker/` | Shared `chunkText()` — paragraph-aware, token window |
| `common/validation/` | Shared Zod schemas + retry-once wrapper |
| `common/ai/` | ProviderService wrapping the ITI API gateway |

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
