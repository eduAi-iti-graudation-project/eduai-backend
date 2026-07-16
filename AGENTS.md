# AGENTS.md
> Canonical, cross-tool instruction file (read natively by OpenCode, Codex,
> Cursor, Copilot, etc). Claude Code reads this too, via the `@AGENTS.md`
> import in this repo's `CLAUDE.md`. Edit this file, not CLAUDE.md, for any
> rule that should apply regardless of which tool a teammate is using.


## Read first, every session
1. `specs.md` — product, architecture, data model, non-negotiable rules
2. `backend-specs.md` — this repo's structure and conventions

## Project
EduAI backend. NestJS + Prisma + Postgres/pgvector (Supabase) + OpenAI SDK.
Modular monolith — one module per feature (see `backend-specs.md`).

## Current sprint — Rubric → Grading pipeline (RAG-based)
We're building the end-to-end grading flow. The pipeline order:

1. **Teacher creates assignment + rubric** — either via manual form or uploading a PDF in natural language → AI extracts structured criteria (Prompt Factory) → teacher reviews/edits → confirms
2. **On confirm** → each rubric criterion's `description` is embedded (OpenAI 1536-dim) and stored in `RubricCriteria.embedding` (pgvector)
3. **Student submits** → raw text gets chunked (~300–500 tokens, paragraph-aware, ~50 token overlap) → each chunk creates a `SubmissionChunk` row
4. **Grading Agent triggers** → for each chunk, retrieve ALL rubric criteria for that assignment → send chunk + criteria to LLM with a structured prompt → LLM returns per-criterion score + feedback + citation of which criterion was violated
5. **Result** → `GradingScore` records created per `(submission, criterion)`. Student sees per-criterion scores and why points were lost
6. **Teacher reviews** → edits scores → confirms (`isConfirmed = true`) → grade becomes real

### Modules involved
| Module | Role |
|---|---|
| `rubrics/` | CRUD, PDF import (Prompt Factory), confirm + embed criteria |
| `common/llm/` | Single `LlmService` wrapping OpenAI SDK — all agents call through this (PII redaction + Zod retry built in) |
| `common/pii/` | Redact student name/ID before any LLM call |
| `common/validation/` | Shared Zod schemas, retry-once wrapper for LLM structured output |
| `submissions/` | Student submit, chunking logic, embed chunks |
| `grading/` | Grading Agent: similarity-search retrieval + LLM call + per-criterion scoring |
| `analysis/` | (next sprint) Deterministic threshold rule + alert explanation |

### Schema gaps identified
- `RubricCriteria` needs `embedding Unsupported("vector(1536)")?` column
- `Rubric` needs `isConfirmed Boolean @default(false)` field
- `GradingScore` already has `pointsAwarded`, `aiFeedback`, `teacherNotes` — correct
- HNSW index on `RubricCriteria`, `SubmissionChunk`, `MaterialChunk` needs raw SQL migration

### Relevant issues
| # | What | Status |
|---|---|---|
| #72 | POST /rubrics | ✅ Done |
| #74 | PDF text extraction | ⬜ Not started |
| #75 | Prompt Factory LLM call | ⬜ Not started |
| #77 | Rubric confirm step | ⬜ Not started |
| #79 | Embed criteria on confirm | ⬜ Not started |
| #80 | HNSW index migration | ⬜ Not started |
| #81–83 | PII redaction | ⬜ Not started |
| #85 | Similarity-search retrieval for criteria | ⬜ Not started |
| #86 | Grading Agent prompt + output schema | ⬜ Not started |
| #88 | Zod validation + retry logic | ⬜ Not started |
| #91 | POST /submissions | ✅ Done (no chunking yet) |
| #97 | Status state machine | ⬜ Not started |

## Commands
- `docker compose up -d` — local Postgres+pgvector
- `npx prisma migrate dev` — apply schema changes
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
