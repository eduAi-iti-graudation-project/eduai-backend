# Seeding Plan — Complete demo dataset for the frontend dev

Status: planned (not implemented). Owner: backend.

## Goal

`npx prisma db seed` produces a complete, reproducible demo dataset for the
frontend dev (all roles: student, teacher, guardian, admin). No curl, no
running server, no LLM calls at seed time. AI-produced artifacts (alerts,
analyses, reports, quiz questions, study-lab payloads, lab code, homework-help
answers, struggle signals) are stored as static, realistic JSON fixtures
mirroring what the agents would write.

## Decisions locked in

- **Approach**: extend `prisma/seed.ts` (idempotent, fixed UUIDs, matching the
  existing style). Existing core seeding (org, grades, sections, courses,
  offerings, users, enrollments, attendance, assignments, rubrics, submissions,
  teacher profiles, class-teacher logs, Arabic meeting fixture, projectile
  material) stays as-is.
- **Reset scope**: full demo-org reset — delete all rows belonging to the demo
  org + seeded demo users (reverse dependency order), then recreate everything.
  Non-seed accounts (`@demo.org`, `@example.com`, `abdallahehab3710@gmail.com`)
  are wiped.
- **Email guarantee**: only the seed's own emails must survive. The seed
  recreates them by email upsert and re-links their Supabase `authId` via
  `createAuthUser` (idempotent), so logins (`password123`) survive a reseed.
- **AI content**: static realistic fixtures, not live agent runs.
- **Curriculum materials**: do NOT expand — keep only the existing projectile
  material/chunks fixture (fails soft without `HF_TOKEN`). The dev uploads real
  materials manually.

## Step 0 — Backup (run before the first reset)

```bash
mkdir -p backups
pg_dump "postgresql://postgres:development_password@localhost:5432/eduai_db" > backups/eduai_db_$(date +%Y%m%d_%H%M%S).sql
```

- Add `backups/` to `.gitignore`.
- Restore: `psql "postgresql://postgres:development_password@localhost:5432/eduai_db" -f backups/<file>.sql`.
- Caveat: the dump covers Postgres only. Supabase Auth users live in Supabase;
  seed emails are re-linked by email, so their logins survive a reseed.

## Step 1 — Full demo-org reset

Delete in reverse dependency order, scoped to the demo org and/or seeded demo
users: meetings (participants, attendance, chat messages, transcripts,
segments), struggle signals, timetable slots, alerts → student analyses →
student reports, notifications, quizzes (answers, attempts, questions), labs,
homework-help interactions, study generations, chat (messages, threads),
guardian/teacher profiles, join requests, membership requests, student/teacher
documents, fee payments, salary records, materials (chunks, chapters),
submissions (chunks, grading scores), rubrics, assignments, attendance,
enrollments, class-teacher logs, course offerings, courses, sections, users,
grade levels. Keep + update the org and school-group rows.

Does NOT touch Supabase Auth.

## Step 2 — New fixtures (fixed UUIDs)

Continuing the `00000000-0000-0000-0000-000000000XXX` scheme.

1. **Meetings** — 3–4 meetings: an upcoming `SCHEDULED` class on an offering
   (join/calendar flow) + a past `ENDED` class with `MeetingParticipant`
   (teacher + 3–4 students), `MeetingAttendance`, `MeetingChatMessage` (5–8),
   `MeetingTranscript` + `MeetingTranscriptSegment` rows (so the transcript
   view renders). Keep the existing Arabic fixture.
2. **Struggle signals** — 3–4 rows on the ENDED class (statuses
   `PENDING`/`SENT`, one `classWide`, linked `quizId`/`interactionId` where
   applicable).
3. **Timetable** — `TimetableSlot`s Mon–Fri per offering (day, `HH:MM:SS`
   time, room) → fills the admin grid + per-section/teacher week views.
4. **Alerts → analyses → reports** — 2–3 `Alert`s (`ACTIVE`/`RESOLVED`; types
   FAILING, ATTENDANCE, …), each with a `StudentAnalysis` (realistic
   `diagnosis`/`teacherContent`/`guardianContent` JSON) and a `StudentReport`
   (3-tier JSON), plus a `StudyGeneration` recommendation linked via
   `recommendedForAnalysisId`.
5. **Notifications** — ~12 rows across roles (unread/read; GRADING_COMPLETE,
   ALERT_CREATED, REPORT_GENERATED, HOMEWORK_REDIRECT, …) for the bell +
   dashboard widgets.
6. **Quizzes** — 3–4 `Quiz`s (2 `PUBLISHED` w/ MCQ/TF/SA `QuizQuestion`s, 1
   `DRAFT`, 1 student-scoped), + 2 `COMPLETED` `QuizAttempt`s with confirmed
   `QuizAnswer`s + 1 `IN_PROGRESS` so quiz-grades views render.
7. **Labs** — 1–2 per offering: `PUBLISHED` (plausible Matter.js
   `generatedCode`, `reviewApproved: true`) + 1 `PENDING_TEACHER_REVIEW`.
8. **Homework help + chat** — 3–4 `HomeworkHelpInteraction`s per student
   (EXPLANATION/HINT/REDIRECT_TEACHER with sources) + 3 `ChatThread`s with
   messages (one auto-opened by a REDIRECT).
9. **Study Lab** — 3–4 `StudyGeneration`s (`STUDY_MATERIAL`, `SLIDES`,
   `PODCAST`, `PRACTICE_QUESTIONS`) with `READY` status + realistic `payload`
   JSON (audio/file URLs null-safe), one linked to an analysis.
10. **Guardian profiles** — `GuardianProfile` rows for the 3 seeded guardians
    (fixes `GET /guardian/me/profile` 404).
11. **Join + membership requests** — 4–6 `JoinRequest`s (ROSTER/SELF, student +
    guardian kinds, pending/approved/rejected, guardian fields) + 2–3
    `MembershipRequest`s (pending, with gradeLevel) for the admin queues.
12. **Student documents** — 3–5 unassigned (`studentId: null`,
    `aiSuggestedCategory`/`aiSuggestedStudentId`/`aiMatchConfidence`) + 2
    assigned for the student tab.
13. **Fees / salaries / teacher docs** — 3–4 `FeePayment`s across students
    (paid/partial/unpaid), 2–3 `SalaryRecord`s per teacher, 2–3
    `TeacherDocument`s per teacher.

### Explicitly skipped

`SubscriptionEvent`, `DeviceToken` — no UI surface.

## Step 3 — Structure & verification

- Organize seed into per-feature helper functions (mirrors the existing
  `seedArabicTranscriptFixture` style) to keep `seed.ts` readable.
- Add a `--check` flag: asserts minimum row counts per model and exits non-zero
  on shortfall (replaces an integration test — existing tests are all
  mocked-Prisma units).
- Preserve `--fast` behavior (skips attendance + bulk submissions).
- Seed prints a per-role demo map at the end (emails / `password123`, key IDs
  for Swagger).

Final validation:

```bash
npx prisma db seed
npx prisma db seed --check
npm run lint
npm test
npm run build
```

## Files touched

- `prisma/seed.ts` — Step 1 cleanup phase, 13 fixture sections, `--check` mode,
  backup instructions in a header comment.
- `.gitignore` — add `backups/`.
- No schema/migration changes.