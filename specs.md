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

Four roles: **Teacher**, **Student**, **Guardian** (parent/guardian), **Admin** (school management/IT).

Attendance is tracked via a mobile app (fingerprint-based) that sends daily
batch data to the API. Parents can view their children's attendance and
academic reports. When a student repeatedly scores low on the same rubric
criterion, a deterministic rule triggers a three-tier report (parent /
teacher / management) delivered automatically via email.

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
8. **Attendance Tracking** — a mobile app (fingerprint-based) sends
   attendance data to the API in batches per (class, date). Records are
   upserted on `@@unique([studentId, classId, date])` for idempotency.
   Teachers and parents view attendance records via dashboard endpoints.
9. **Criterion-Specific Pattern Detection** — a deterministic function
   checks every newly confirmed `GradingScore`: if the same rubric criterion
   scored below 50% of `maxPoints` for 2 consecutive submissions, it flags
   the student. This is plain code — same philosophy as §3.4. It is separate
   from the Analysis Agent (§3.4), which checks overall grade averages.
10. **Three-Tier Report Generation** — when a criterion pattern is detected,
    an LLM generates three role-specific reports in a single call:
    - **Parent report**: overall performance summary + at-home improvement
      suggestions
    - **Teacher report**: what went wrong + instructional recommendations
      based on the assignment content and class curriculum
    - **Management report**: honest evaluation of the teacher's performance
      — what worked and what didn't — based on the teacher's assignments,
      rubrics, and student outcomes across their classes
11. **Notification Delivery** — reports are auto-sent via email (SMTP /
    nodemailer) to the student's guardians, the teacher, and the school
    admin. Push notification infrastructure (FCM token storage) is built
    into the `NotificationService` but only email is wired in MVP.

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
- **Criterion pattern detection trigger is plain code, not a prompt.**
  The same rule as §3.4 applies: if you find yourself asking an LLM "is
  this student struggling with grammar," that logic belongs in code.
- **Reports are auto-sent on generation** — no manual approval gate in MVP.
  Teacher and management may view all reports via dashboard endpoints.
- **Attendance data from the mobile app is trusted as-is.** No teacher
  verification step in MVP.

## 5. Data model

Canonical schema is `schema.prisma` in the backend repo. Key entities:
`User` (role in `UserRole` enum: TEACHER, STUDENT, GUARDIAN, ADMIN),
`Class`, `Enrollment`, `Rubric` → `RubricCriterion` (has
`embedding vector(1024)`), `Assignment`, `Submission` (status:
SUBMITTED → GRADING_IN_PROGRESS → REVIEW_READY → CONFIRMED) →
`SubmissionChunk` (has `embedding vector(1024)`), `GradingScore`
(pointsAwarded, aiFeedback, teacherNotes, `isConfirmed` flag,
`@@unique([submissionId, criteriaId])`), `Material` →
`MaterialChunk` (curriculum RAG for the Assistant Agent), `Alert`
(type, reason, status), plus:

- **`GuardianStudent`** — links a guardian (`User.role = GUARDIAN`) to
  one or more students. Enables a parent dashboard with attendance +
  report data for their children.
- **`Attendance`** — per-student daily attendance record:
  `(studentId, classId, date, status: PRESENT/ABSENT/LATE/EXCUSED)` with
  `@@unique([studentId, classId, date])`.
- **`StudentReport`** — generated when a criterion pattern is detected.
  Stores type (`CRITERION_FLAG`), `details` JSON (the three role-specific
  report texts), and status (`PENDING / SENT`).
- **`Notification`** — audit log of sent reports. Stores `reportId`,
  `recipientType` (PARENT / TEACHER / ADMIN), `recipientEmail`, `channel`
  (EMAIL / PUSH), status (`SENT / FAILED`).
- **`PushToken`** — device tokens for push notifications:
  `(userId, token, platform)`.

**File storage (Supabase Storage):**
- `Material.fileUrl` stores the Supabase Storage URL of the uploaded PDF.
  The extracted text goes into `MaterialChunk.content` for RAG; the
  original PDF is preserved for download.
- `Submission` and `Rubric` imported PDFs: text is extracted and stored
  in DB; the original file is discarded. Students submit via text
  (browser), not file upload.

Embeddings: **HuggingFace `mixedbread-ai/mxbai-embed-large-v1`, 1024
dimensions.** Stored via `Unsupported("vector(1024)")` in Prisma and raw
SQL `$executeRawUnsafe` with `::vector` cast. Chat LLM is a custom
provider at `CUSTOM_PROVIDER_BASE_URL` (ITI API gateway), model
`openai.gpt-oss-20b-1:0`.

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
