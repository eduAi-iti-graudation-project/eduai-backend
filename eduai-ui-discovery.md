# EduAI — Product & UI Discovery Reference

> Written for a downstream reasoning agent that will produce a Stitch-based UI.
> This file is **facts only**: what the product does, who uses it, how the
> flows work, and every state a screen must represent. It deliberately
> contains **no** visual design, layouts, or CSS decisions. The last section
> contains design *considerations* you may use as hints — everything before
> it is contract.
>
> All endpoint paths are the REST routes the frontend calls. All status values
> and field names are spelled exactly as the API returns them — a UI must not
> invent alternatives.

---

## 1. Product in one page

EduAI is a web app for schools. Its promise: **a teacher grades student work
faster, and struggling students get flagged early.**

Core idea, end to end:

1. A teacher builds (or PDF-imports) a **rubric** for an assignment.
2. A student submits written work. Behind the scenes it is chunked and graded
   by an **AI grading pipeline** that suggests a score per rubric criterion,
   each score citing the exact rubric criterion it used.
3. The **teacher reviews** the AI's suggested scores, edits any of them, then
   confirms. The AI never has the final word — a grade is invisible to a
   student until a teacher confirms it.
4. After enough confirmed grades exist, a **deterministic rule** (not an AI
   judgment) flags a student who is struggling (repeated low marks or a
   downward trend). An LLM writes a plain-language explanation for *why*.
5. **Reports** are auto-generated (parent / teacher / management sections),
   and **notifications** are auto-sent by email. A guardian (parent) gets a
   dashboard over their child's performance.

Extended features around that loop:

- AI **quiz engine** — teachers generate quizzes from class curriculum
  materials, students take them with **anti-cheat** tracking, short answers
  are AI-graded and confirmed by the teacher.
- **Homework Helper** — students ask assignment questions in plain language;
  the AI answers with hints (never the answer) and notifies the teacher when
  a student is stuck.
- **Classroom chat** — teacher ↔ student real-time messaging.
- **Attendance** — teacher bulk-imports attendance; students and guardians
  see it.
- **Insights dashboards** — charted analytics per role (enterprise tier).
- **Organizations** — every user belongs to a school with its own admin,
  seat limit, and billing.

Four roles: **Teacher, Student, Guardian, Admin** (Admin is the school's
operator/owner, not a global platform role).

---

## 2. Roles and product packaging

### Roles (exact — do not rename, do not add)

| Role | Who | What they get |
|---|---|---|
| `ADMIN` | The first person to sign up (creates the school/org) | Billing, seats, membership requests, grade levels, student management, admin dashboard, sees all alerts |
| `TEACHER` | Runs classes | Rubrics, grading review, assignments, attendance import, alerts, quizzes, reports, chat, dashboard |
| `STUDENT` | Learner | Submit assignments, see confirmed grades, take quizzes, homework help, chat, attendance, own alerts, dashboard |
| `GUARDIAN` | Parent of a student | Child overview, child grades, alerts, reports, dashboards |

A user has exactly one role.

### Plans and tiers (the UI must surface this)

Every organization starts with a **14-day free trial**; after it expires a
plan is required or PRO features lock.

| Plan id passed to checkout | Tier (API enum) | Seats |
|---|---|---|
| `basic` | `BASIC` | 30 |
| `pro` | `PRO` | 100 |
| `enterprise` | `ENTERPRISE` | 500 |

Feature gates (show an upgrade prompt for these):

- **PRO / ENTERPRISE**: AI quiz generation, AI assistant chat, homework
  helper, reports, teacher↔student chat.
- **ENTERPRISE only**: insights dashboards.
- During `TRIALING`: full pass, no tier enforcement, for 14 days.

Subscription states: `TRIALING` (14 days) → `ACTIVE` | `PAST_DUE` | `CANCELED`.

**Seat limits**: approving a membership request is blocked when the org is at
its seat limit — the admin UI must show "x of y seats used".

---

## 3. Teacher features (full surface)

Areas/screens for the teacher.

### Dashboard / overview
Number cards: class count, unconfirmed (pending) AI-graded scores,
active alert count, resolved/dismissed alert count; plus two lists:
recent alerts (top 10) and submissions needing review (top 10); plus unread
notifications count.

### Classes
- List classes, each with its teacher, enrollments (student list) and grade.
- Enroll a student directly (immediately `APPROVED`).
- See pending join requests → approve / reject.
- Remove a student from a class.

### Assignments
- Create / edit / delete: title, description, due date, total points, class.
- "Open" is simply `dueDate >= now`; overdue is `dueDate < now`. There is no
  published/draft flag on assignments.

### Rubrics
- Create manually: title + criteria (`description`, `maxPoints`).
- Import a PDF → AI extracts criteria into a preview table → teacher edits →
  saves → confirms (locks and embeds vectors for AI grading).
- Confirm is one-way: no unconfirm, no edit after confirm.
- Grading only ever uses confirmed rubrics. Trying to grade before one
  yields "No confirmed rubric exists for this assignment".

### Submissions: list & review
- List per assignment, filter by `status` (four states) and by assignment;
  each row: student name, submission date, status.
- Detail/review screen:
  - the student's written work (chunked text shown in order; plain text for
    PDF uploads)
  - one block per rubric criterion: max points, AI-suggested points, AI
    justification (2–4 sentences), editable points input
  - a 1–2 sentence AI overall summary ("why this grade") at the top
  - one **Confirm All** action (primary).
- After confirm, feedback-writing and student analysis run in the background.

### AI grading
- Trigger or re-run the grading agent for a single submission.
- Transient "in progress" state between submit and ready.
- A failed AI call still lands the submission in `REVIEW_READY` — the UI
  must be able to show a review screen with whatever scores exist.

### Quizzes
- Manual quiz editor: title, description, time limit (minutes), passing
  score; questions: type (`MCQ`, `TRUE_FALSE`, `SHORT_ANSWER`, `ESSAY`),
  text, options (MCQ = 4, TRUE_FALSE = 2) with correct answer, points, order.
- Generate quiz wizard: pick class, topic, question count, question types,
  difficulty `EASY` / `MEDIUM` / `HARD` → produces a DRAFT quiz to review and
  publish. Generation needs curriculum material; if none matches the topic,
  the wizard must say so and point to uploading material.
- Publish → students can attempt. Close when done → `CLOSED`.

### Quiz results (attempts)
- Per student: status, started/submitted time, totalScore, answers count,
  violations (tab-switch / full-screen-exit) with a warning badge.
- Attempt detail: each question + the student's answer + per-answer score +
  whether it is confirmed or a pending AI grade + aiFeedback; edit an AI
  score; confirm to recompute the total.
- Anti-cheat is client-reported; treat the violations badge as evidence, not
  verdict.

### Alerts & reports
- Alert list (`status` filter) — each row: student, class, alert type,
  reason (plain language), severity (`LOW`/`MEDIUM`/`HIGH`), created at,
  skill-gap count.
- Alert detail: up to five AI-generated sections — diagnosis (stats),
  teacher insights + skill gaps + suggested interventions, a guardian-ready
  message draft, teacher feedback (class-level), management summary.
- Resolve / Dismiss (one-way; no reopen).
- Reports (auto-generated, no manual create): parent / teacher / management
  sections; enterprise gate.

### Chat
- Thread list with unread counts, per-thread timeline, real-time updates.

### Insights (teacher)
- Weekly/monthly charts: submissions volume, confirmed grades, pending
  confirmations, alerts created, alerts resolved, attendance, class average,
  per-criterion average, struggling students; drill into one student.

### AI assistant
- Free-form prompt that produces: quiz, rubric, lesson summary, lesson plan,
  assignment draft, class analytics — grounded in the class curriculum.
- No persisted history: a refresh resets the conversation.

### Notifications
- Bell with unread count, list, mark-read.

---

## 4. Student features (full surface)

### Dashboard
Upcoming assignments (title, due date, class); recent confirmed grades
(assignment title, score, total points, percentage); attendance rate;
active alerts on self (type + reason); unread notifications; grade level.

### Assignments & submissions
- List/detail of their assignments.
- Submit text or PDF — instant response `{ status: 'SUBMITTED' }`.
- Students do NOT see AI grades. Mapping of status to what a student sees:

| Status | What the student sees |
|---|---|
| `SUBMITTED` | "Submitted — awaiting review" |
| `GRADING_IN_PROGRESS` | "Being graded…" (no numbers) |
| `REVIEW_READY` | **Nothing new** (AI grades are teacher-only) |
| `CONFIRMED` | The grade appears |

### Grades
- Per assignment: confirmed criterion rows (criterion description, points /
  max points, final feedback). Confirmed-only, always.

### Quizzes
- Quiz list for the class (only `PUBLISHED` can be started).
- Take flow: start → server-synced countdown (`expiresAt` / `serverNow`),
  anti-cheat auto-reporting (tab switch / full-screen exit), local
  auto-save, answers submitted once at the end; MCQ/TF auto-scored
  immediately, short answers marked "AI-graded — pending teacher confirm".
- Result view: current total (auto-graded portion), per-question feedback;
  pass/fail is client-side math (`totalScore >= passingScore`).

### Homework helper
- Ask a question against an assignment → answer with action
  `HINT` / `EXPLANATION` / `REDIRECT_TEACHER` (redirect notifies the teacher
  and opens a chat thread) plus a sources list; rate the reply
  `HELPFUL` / `NOT_HELPFUL`; history per class.

### Attendance
- Records (date × status `PRESENT` / `ABSENT` / `LATE` / `EXCUSED`) per
  class plus overall rate.

### Classes
- Available classes (same grade, not yet enrolled) → request to join →
  `PENDING` → teacher approves / rejects.

### Chat
- Thread with their teacher, real-time.

---

## 5. Guardian features (full surface)

- First screen: one card per child — name, class, overall average %,
  attendance %, active alert count, unread report count.
- Child detail: confirmed grades, attendance, alerts, reports.
- Read the **parent section** of each report (parent-friendly language).
- Notifications about their child's alerts and reports.
- Insights charts per child (enterprise gate).

The guardian has no teacher features: no rubrics, no grading, no editing.

---

## 6. Admin features (full surface)

The admin is the org operator (the first signup) and gets everything the
teacher has **plus**:

- **Admin dashboard**: teacher count, student count, class count, flagged
  student count, average pass rate, pending reports, teachers table with
  class average and student count.
- **People**: grade level CRUD (levels 1–12), classes per grade, student
  management (name, email, grade, link a guardian), view a student's grades.
- **Membership**: pending join-code requests (approve / reject, role
  override, seat check), invite-by-email (role TEACHER/STUDENT), regenerate
  the join code, seat usage display.
- **Billing**: current tier/status, checkout, change plan, billing portal;
  plan cards basic/pro/enterprise; payment failure state (`PAST_DUE` →
  recovery prompt).
- **Alerts**: org-wide alert list and resolution.
- **Insights** (enterprise gate).

---

## 7. Core flows — exact state machines

> These are the states a screen must (a) render and (b) never invent extra
> values for.

### 7.1 Submission lifecycle

```
SUBMITTED → GRADING_IN_PROGRESS → REVIEW_READY → CONFIRMED
```

One-way; nothing ever goes backward; `CONFIRMED` is terminal and its scores
are immutable (editing a confirmed score returns 409).

- Student submits text or PDF → immediate `{ id, status: 'SUBMITTED' }`.
- Grading runs in the background (fire-and-forget). **There is no polling
  endpoint**; the UI only sees the transition by re-fetching the submission.
  The UI may show a client-side "grading…" state but must not fabricate
  numbers.
- Failed AI grading → still `REVIEW_READY` with whatever scores exist.
- For the teacher, `REVIEW_READY` is the "needs review" state — the primary
  call to action across the teacher experience.

### 7.2 Grading score lifecycle (teacher review rows)

One row per rubric criterion (`[submissionId, criteriaId]` unique). The
review UI shows, per row:

- criterion description + max points
- AI-suggested points + aiFeedback (the justification)
- editable points input
- pending vs confirmed state.

Flow: review each row → **Confirm All** once. After that every row is
`isConfirmed = true` and locked. Optional teacher notes per row.

Feedback writing, communication analysis, and report generation trigger
fire-and-forget after confirm — content may appear later; the UI must not
block on it.

### 7.3 Rubric lifecycle

```
draft (isConfirmed=false)  →  (PDF import → preview → create)  →  confirm
→ embedded + locked
```

- Confirm embeds criterion vectors for semantic retrieval.
- One-way; no edits after confirm.
- Only confirmed rubrics are used for grading.

### 7.4 Quiz lifecycle

```
Quiz:      DRAFT → PUBLISHED → CLOSED
Attempt:   IN_PROGRESS → COMPLETED
```

- Only `PUBLISHED` quizzes can be started.
- One attempt per student per quiz (unique constraint).
- Start returns `expiresAt` (only if a time limit is set) and `serverNow` —
  the countdown is computed from these (clock-synced).
- Anti-cheat: the client reports `TAB_SWITCH` / `FULLSCREEN_EXIT` while the
  attempt is `IN_PROGRESS`; the server appends them.
- MCQ / TRUE_FALSE are auto-graded at submit (`isConfirmed: true`);
  SHORT_ANSWER / ESSAY are AI-graded suggestions pending teacher
  confirmation. The submit-time total only counts auto-graded answers.
- Teacher confirms → total score is recomputed from all answers → final.

### 7.5 Alerts & reports lifecycle

```
confirmed grades → deterministic rule → Alert (ACTIVE)
   → notifications (teacher + guardian if linked)
   → StudentReport auto-created (parent/teacher/management sections)
```

- Alert status: `ACTIVE` → `RESOLVED | DISMISSED` (one-way, no reopen).
- Report status: `NEW` → `SENT` → `VIEWED` (frontend drives the latter two).
- No manual create UI for either — only resolve/dismiss and status.

### 7.6 Membership / onboarding lifecycle

- Signup without a join code → creates a new organization; the signer
  becomes **ADMIN** and enters the app.
- Signup with a join code → account is **PENDING**; the user must not enter
  the app — show a "waiting for admin approval" screen until an admin
  approves the membership request.

---

## 8. Cross-cutting behaviors the UI must embody

1. **Human in the loop.** A pending AI suggestion is never presented as a
   final grade. Labels and copy must say "AI-suggested / pending" until
   confirmed.
2. **No grading poll.** Grading is background work. The UI can show a
   transient "in progress" state, but everything after that is learned by
   re-fetching the list/detail.
3. **Fire-and-forget everywhere.** Feedback, analysis, reports,
   notifications all lag creation. Render "in progress / will be sent"
   gracefully instead of failing.
4. **Empty states are frequent and real:** no confirmed rubric (cannot
   grade), an assignment with zero submissions, no alerts, no reports, a
   guardian with no child, quiz generation with no matching curriculum
   material ("upload material covering this topic first").
5. **Join-code nuance** — see 7.6: no-join-code signup becomes ADMIN;
   join-code signup is PENDING and must not enter the app.
6. **Pass/fail is client-side math**: `totalScore >= passingScore`.
7. **Only confirmed rows are grades.** Whatever a student/guardian screen
   shows already comes from confirmed data; copy must not imply drafts.
8. **Classic list → detail** navigation with "see all" affordances from
   dashboards.

---

## 9. State / enum dictionary for labels and badges

| Entity | Values | Note |
|---|---|---|
| Submission | `SUBMITTED`, `GRADING_IN_PROGRESS`, `REVIEW_READY`, `CONFIRMED` | one-way chain |
| GradingScore | `isConfirmed` true/false | pending vs committed |
| Rubric | `isConfirmed` true/false | draft vs grading-ready |
| Enrollment | `PENDING`, `APPROVED`, `REJECTED` | join flow |
| Attendance | `PRESENT`, `ABSENT`, `LATE`, `EXCUSED` | |
| Alert status | `ACTIVE`, `RESOLVED`, `DISMISSED` | one-way close |
| Alert type | `FAILING`, `DOWNWARD_TREND`, `CONSISTENT_STRUGGLE`, `WEAK_CRITERION` | |
| Severity | `LOW`, `MEDIUM`, `HIGH` | derived from analysis |
| Report | `NEW`, `SENT`, `VIEWED` | |
| Notification | readAt null vs timestamp | unread vs read |
| Quiz | `DRAFT`, `PUBLISHED`, `CLOSED` | |
| Question type | `MCQ`, `TRUE_FALSE`, `SHORT_ANSWER`, `ESSAY` | |
| Attempt | `IN_PROGRESS`, `COMPLETED` | one per student |
| Violation | `TAB_SWITCH`, `FULLSCREEN_EXIT` | anti-cheat events |
| Homework action | `HINT`, `EXPLANATION`, `REDIRECT_TEACHER` | |
| Subscription | `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED` | plans: basic/pro/enterprise |
| Seats | used vs limit (30/100/500) | from org |

---

## 10. Feature gaps — do not design for these

The API does not yet support these; a UI must not invent them:

- Student-initiated **regrade requests**.
- Editing or reopening a **rubric after confirm**.
- Unlocking/resetting scores after confirm.
- A manual report approval gate (reports auto-send by policy).
- Bulk "grade all submissions" across a class in one screen (confirmation is
  per submission).
- Multiple quiz attempts per student, or adaptive/difficulty-mixed quizzes
  per student.
- Attendance edit history or retroactive fix flows.
- Per-question explanations for MCQ/TF (auto-graded, no feedback text) — only
  short answers get AI feedback.

Where the UI must communicate status, use the API fields in section 9 — never
fictional states.

---

## 11. Design considerations (hints, not design)

These are the only hints; use what fits:

1. **Confirm is the north star.** The teacher workflow ends in "Review &
   Confirm". Give "needs review" a prominent, urgent treatment in the
   teacher dashboard and submission list.
2. **Suggested vs final is a state, not styling.** Pending AI content must be
   marked "AI-suggested / pending" whatever its color or label; a student
   must never stumble onto AI grade suggestions.
3. **Progress over polling.** Grading feels alive: a transient
   "in progress" treatment (and a believable refresh cadence) beats dead
   "last updated" text.
4. **Empty states teach.** Before a real rubric exists the teacher needs to
   know to make one; before the first report a guardian needs a warm
   placeholder. Every empty state should be actionable or instructional.
5. **Guardian = outcome-first.** A small child card (average, attendance,
   alerts) beats data clutter; no tool-internal detail.
6. **Keep the timer authoritative.** The quiz countdown uses server-synced
   `expiresAt` / `serverNow`. Tab-switch and expiry are dramatic UI moments;
   make them clear, not alarming.
7. **Dashboards list, pages manage.** Dashboards show top-N with "see all";
   the full pages carry the workflows.
8. **Show the why.** In teacher review, show the aiFeedback with the rubric
   criterion, not just a number.
9. **Trial/upgrade moments** map to features the org cannot use yet; never
   conflate a plan limit with a failure state.
10. **Seat meter** in admin people view: used seats vs limit, and a warning
    when approval would exceed it.

---

*This document is extracted from the API contract, the data model, and the
current feature set. If the UI disagrees with a status value here, the UI is
wrong — a screen must render the state, not a fictional one.*
