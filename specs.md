# EduAI — Project Specification

> **Canonical copy of this file lives in the backend repo.** If you're editing
> it, edit it there first, then copy it verbatim into the frontend repo's
> root. Both repos should always have an identical copy of this file. This
> file is product + architecture + cross-cutting rules only. Repo-local
> implementation detail lives in `backend-specs.md` or `frontend-specs.md`.

## 1. What this product is

EduAI is a web app that helps a teacher grade student work faster and notice
struggling students earlier. A student submits an assignment. An AI grading
pipeline suggests a score, citing the exact rubric criterion it used. The
teacher reviews, edits if needed, and confirms — the AI never has the final
word. Once enough grades are confirmed for a student, a deterministic rule
(not an AI judgment call) flags them as needing attention, and an AI call
writes a plain-language explanation of why.

Two roles: **Teacher**, **Student**. No admin role in MVP scope.

## 2. Repos

- **Backend repo** — NestJS API, Prisma ORM, all business logic, all AI
  calls, all database access.
- **Frontend repo** — React + Vite SPA. No server-side rendering. Talks to
  the backend only via its REST API. Never talks to the database, Supabase,
  or any LLM API directly.
- Both repos use `main` (protected, deploys automatically) and `dev`
  (protected, integration branch). Feature branches target `dev`.

## 3. Core features (in priority order — do not build later ones before
   earlier ones are solid)

1. **Rubric Builder** — manual form (criterion + points) is the baseline.
   "Import from PDF" (the Prompt Factory) extracts criteria from a messy PDF
   into the same structured shape; the teacher always reviews/edits before
   it's confirmed and gradeable.
2. **Grading Agent** — retrieves the relevant rubric criteria (and, for long
   submissions, the relevant submission chunk) and returns a structured score
   per criterion, each one citing the exact criterion it's based on. This is
   a single well-designed LLM call with retrieval feeding it — not a
   tool-using agent. It does not decide what to retrieve; the retrieval step
   decides that for it.
3. **Teacher Review & Confirm** — the human always has final say. A grade is
   not real (not visible to the student, not eligible for analysis) until
   `isConfirmed = true`.
4. **Analysis Agent** — a plain deterministic function decides who's
   flagged, never an LLM. Rule: **average of last 3 confirmed grades below
   60%, OR 2 consecutive confirmed grades each dropping** (either condition
   trips a flag — `AlertType.FAILING` or `AlertType.DOWNWARD_TREND`
   respectively; `CONSISTENT_STRUGGLE` for a student who is repeatedly
   flagged over time). An LLM call is used only to turn the numbers into a
   one-paragraph plain-language explanation, stored in `Alert.reason`.
5. **Assistant Agent** — the one genuinely tool-using agent. A teacher asks
   for something (a quiz, a lesson summary); the agent decides what to
   search for in the class's curriculum material and generates a draft.
   No persisted chat history for MVP — conversation lives in frontend state
   only, resets on refresh. This is an intentional scope cut, not a gap.
6. **Orchestrator** — not an LLM. Plain backend logic enforcing that the
   Analysis Agent only ever runs against `isConfirmed = true` rows. A
   sequencing bug here is invisible (produces false alerts silently), so it
   must be deterministic and testable, never an AI "decision."
7. **Vision/OCR submissions (stretch goal)** — photo of handwritten work,
   graded via a vision-capable LLM call. Build only after 1–6 are solid.

## 4. Non-negotiable rules (violating these is a bug, not a style choice)

- **PII redaction**: student name/ID must be stripped from any text sent to
  an LLM API. Redact, call the LLM, re-attach the real identity afterward
  using the internal ID — never the reverse order.
- **Every LLM call that returns structured data must be schema-validated**
  (Zod) with exactly one retry on a malformed response, then a graceful
  failure — never let a malformed LLM response silently corrupt a grade.
- **A grade is not visible to a student, and not eligible for analysis,
  until a teacher has confirmed it.** No code path may skip this.
- **The Analysis Agent's trigger condition is a plain function, not a
  prompt.** If you find yourself writing a prompt that asks an LLM "is this
  student struggling," stop — that logic belongs in code, per §3.4.
- **Every citation in a grading response must point to a real
  `RubricCriterion.id`** the retrieval step actually returned — never a
  criterion the LLM recalls from training or invents.

## 5. Data model

Canonical schema is `schema.prisma` in the backend repo. Key entities:
`User` (role: TEACHER/STUDENT), `Class`, `Enrollment`, `Rubric` →
`RubricCriterion` (has `embedding vector(1536)`), `Assignment`, `Submission`
(status: PENDING → GRADING → REVIEW_READY → CONFIRMED) → `SubmissionChunk`
(has `embedding vector(1536)`), `CriterionFeedback` (suggested + confirmed
score/feedback in one row, `isConfirmed` flag), `ClassMaterial` →
`MaterialChunk` (curriculum RAG for the Assistant Agent), `Alert` (type,
reason, status).

Embeddings: **OpenAI, 1536 dimensions.** This is a locked decision — do not
switch embedding providers without a schema migration.

## 6. RAG design

Two independent retrieval paths, both using pgvector cosine similarity:

1. **Grading retrieval**: given a submission, embed the relevant chunk(s)
   (see `SubmissionChunk` — chunk ~300–500 tokens, paragraph-boundary aware,
   ~50 token overlap) and search that assignment's `RubricCriterion` rows.
   Rubrics are small (typically 4–8 criteria) — retrieve against *all* of
   them rather than an aggressive top-k, so nothing (e.g. "grammar") is
   silently skipped because it wasn't topically similar to what the student
   wrote about.
2. **Curriculum retrieval** (Assistant Agent only): `ClassMaterial` is
   chunked and embedded at upload time into `MaterialChunk`; the Assistant's
   `search_curriculum` tool searches this when generating a quiz or summary.

`Unsupported("vector(1536)")` fields need a raw SQL migration for a
similarity index — Prisma does not generate this automatically:
```sql
CREATE INDEX ON "RubricCriterion" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON "SubmissionChunk" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON "MaterialChunk" USING hnsw (embedding vector_cosine_ops);
```

## 7. Agent architecture — the honest version

| Piece | What it actually is |
|---|---|
| Grading Agent | One LLM call, retrieval feeds it, no tool use |
| Analysis Agent | Plain code decides the flag; LLM only writes the explanation |
| Assistant Agent | Real tool-calling loop (search_curriculum, create_quiz), max 5 iterations |
| Orchestrator | Not an LLM at all — deterministic status-transition logic |

Do not add tool-calling or autonomy to Grading or Analysis "to make it more
agentic." Their determinism is a deliberate correctness choice, not a
missing feature.

## 8. Testing philosophy

Don't test AI creativity (unfalsifiable). Do test the deterministic code
around it: the alert threshold rule, PII redaction, Zod validation + retry,
and the submission status state machine (invalid transitions must be
rejected). Jest in both repos.

## 9. Definition of done for any task

- [ ] Matches this spec (or the relevant repo-local spec)
- [ ] Has a test if it touches §4's non-negotiables
- [ ] Passes CI (lint, type-check, test, build) in its own repo
- [ ] PR into `dev`, reviewed by one teammate, before merge
