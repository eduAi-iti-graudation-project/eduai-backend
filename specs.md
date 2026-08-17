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

Four roles: **Teacher**, **Student**, **Guardian**, **Admin**.

## 2. Repos

- **Backend repo** — NestJS API, Prisma ORM, all business logic, all AI
  calls, all database access.
- **Frontend repo** — React + Vite SPA. No server-side rendering. Talks to
  the backend only via its REST API. Never talks to the database, Supabase,
  or any LLM API directly.
- Both repos use `main` (protected, deploys automatically) and `dev`
  (protected, integration branch). Feature branches target `dev`.

## 3. Core features (all items below are implemented and shipped in `dev`)

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
8. **Auto-grade on Submission** — when a student submits, the grading agent
   runs immediately (fire-and-forget in background). The student never sees
   AI grades; only the teacher sees them during review. Teacher is notified
   when grading finishes.
9. **Bulk Grade Confirmation** — teacher edits AI-suggested scores, clicks
   one "Confirm All" button. All scores for that submission atomically
   set `isConfirmed = true`, submission status → `CONFIRMED`.
10. **Three-Tier Reports** — when an Alert is created, a single LLM call
    auto-generates three report sections (parent-friendly, teacher-detailed,
    management-summary) stored in a `StudentReport` row.
11. **Notification Delivery** — reports and grading-complete events are
    auto-sent via email (nodemailer) to teachers, guardians, and admins.
    Push notification infrastructure (FCM token storage) is built into the
    `NotificationService` but only email is wired in MVP.
12. **Unified Dashboard** — single `GET /dashboard/overview` endpoint returns
    role-specific data (teacher: class summaries + pending confirmations;
    student: upcoming assignments + confirmed grades; guardian: child overview;
    admin: school-wide stats).
13. **Feedback Writer Agent** — a Mastra agent writes per-criterion
    natural-language feedback explaining why the student got that score and
    how to improve. It fires (fire-and-forget) after the teacher confirms
    scores, writing to `GradingScore.aiFeedback`; a backfill endpoint covers
    historically confirmed scores without feedback.
14. **Homework Helper Agent** — students ask assignment questions in plain
    language via `POST /assistant/homework-help`; the agent searches
    curriculum, looks up assignment context, and returns hints or
    explanations without giving away the answer. Logs interactions
    (`HomeworkHelpInteraction`) so the teacher knows who's struggling.
15. **Quiz Engine** — teachers generate quizzes from curriculum context
    (Mastra agent) and assign them to one or more sections (optionally
    targeting specific students); students see quizzes for sections they're
    approved-enrolled in or quizzes targeted at them, and take them with
    anti-cheat violation tracking; short answers are graded with teacher
    confirmation before scores are real. A quiz is reusable — the same quiz
    can be assigned to many sections and reused across courses/grades, may
    have an optional `endsAt` closing deadline, and carries a `difficulty`
    (EASY/MEDIUM/HARD, default MEDIUM) that calibrates AI-generated
    question depth.
16. **Communication Agent** — after a teacher confirms grades, a Mastra
    agent analyzes the student's performance and creates alerts with
    plain-language explanations, notifying the guardian when tripped.

## 4. Non-negotiable rules (violating these is a bug, not a style choice)

- **PII redaction**: student name/ID must be stripped from any text sent to
  an LLM API. Redact, call the LLM, re-attach the real identity afterward
  using the internal ID — never the reverse order.
- **Every LLM call that returns structured data must be schema-validated**
  (Zod) with a bounded retry budget (default 3 total attempts) on a
  malformed response, then a graceful failure — never let a malformed LLM
  response silently corrupt a grade.
- **A grade is not visible to a student, and not eligible for analysis,
  until a teacher has confirmed it.** No code path may skip this.
- **The Analysis Agent's trigger condition is a plain function, not a
  prompt.** If you find yourself writing a prompt that asks an LLM "is this
  student struggling," stop — that logic belongs in code, per §3.4.
- **Every citation in a grading response must point to a real
   `RubricCriterion.id`** the retrieval step actually returned — never a
   criterion the LLM recalls from training or invents.
- **Criterion pattern detection trigger is plain code, not a prompt.**
  The same rule as §3.4 applies: if you find yourself asking an LLM "is
  this student struggling with grammar," that logic belongs in code.
- **Reports are auto-sent on generation** — no manual approval gate in MVP.
  Teacher and management may view all reports via dashboard endpoints.
- **Attendance data from the mobile app is trusted as-is.** No teacher
  verification step in MVP.

## 5. Data model

Canonical schema is `schema.prisma` in the backend repo. Key entities:
`User` (role: TEACHER/STUDENT/GUARDIAN/ADMIN, links to Supabase Auth by
unique `authId`), `Class`, `Enrollment`,
`Rubric` → `RubricCriterion` (has `embedding vector(1024)`), `Assignment`,
`Submission` (status: SUBMITTED → GRADING_IN_PROGRESS → REVIEW_READY →
CONFIRMED) → `SubmissionChunk` (has `embedding vector(1024)`),
`GradingScore` (suggested + confirmed score/feedback in one row,
`isConfirmed` flag), `Material` → `MaterialChunk` (curriculum RAG for
Assistant Agent), `Alert` (type, reason, status), `Notification` (user,
type, channel, read status), `StudentReport` (three-section LLM output per
alert), `DeviceToken` (FCM push tokens), `Attendance` (student, class,
date, status), `StudentAnalysis` (communication-agent output per student),
`HomeworkHelpInteraction` (homework-helper Q&A log), and the quiz set:
`Quiz` (has `endsAt`, `difficulty` — EASY/MEDIUM/HARD — and belongs to a
teacher) → `QuizAssignment`
(course offering + optional `targetStudentIds`; a quiz can be assigned to
many sections and reused across courses/grades) → `QuizQuestion` +
`QuizAnswer`, `QuizAttempt` (status, violations log, unique per
quiz+student).

Embeddings: **HuggingFace (via the ITI API gateway), 1024 dimensions.** This
is a locked decision — do not switch embedding providers without a schema
migration.

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

`Unsupported("vector(1024)")` fields need a raw SQL migration for a
similarity index — Prisma does not generate this automatically (already
applied in migration `add_hnsw_indexes`):
```sql
CREATE INDEX ON rubric_criteria USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON submission_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON material_chunks USING hnsw (embedding vector_cosine_ops);
```

## 7. Agent architecture — the honest version

| Piece | What it actually is |
|---|---|---|
| Grading Agent | One LLM call, retrieval feeds it, no tool use |
| Analysis Agent | Plain code decides the flag; LLM only writes the explanation |
| Assistant Agent | Real tool-calling loop (search_curriculum, create_quiz), max 5 iterations |
| Orchestrator | Not an LLM at all — deterministic status-transition logic |
| Criterion Detector | Plain code decides the flag (50% × 2 consecutive); LLM generates three role-specific reports |
| Notification Dispatcher | Not AI — plain code that calls NotificationService after a report is created |
| Feedback Writer | Mastra agent with one tool per criterion; calls LlmService, saves to GradingScore.aiFeedback; fires after confirmAll + via backfill endpoint |
| Homework Helper | Mastra multi-tool agent (search_curriculum, lookup_assignment, log_interaction); student-facing POST endpoint |
| Communication Agent | Mastra agent (student_profile, class_context, create_alert, log_analysis, notify_recipient); fires after confirmAll, creates alerts |
| Quiz Generation | Mastra agent (generate_questions, review_questions, save_quiz, search_curriculum); teachers generate quizzes from curriculum |

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
