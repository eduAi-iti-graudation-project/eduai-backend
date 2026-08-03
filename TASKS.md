# TASKS.md — EduAI Backend Work Items

> Read by other coding agents. Each task below is self-contained: it states
> the context, the exact files to touch, the design decisions already made
> (and the ones still open), the required tests, and the acceptance criteria.
> A task with no tests section is a bug in this file — fix the file before
> writing code.
>
> Conventions that apply to every task (see `AGENTS.md`):
> - Work on a feature branch → PR into `dev` (1 review + CI required).
> - Controllers stay thin; no Prisma calls outside a service.
> - PII is stripped before any LLM call, always.
> - Run `npm run lint` / `npm run test` / `npm run build` before finishing.
>
> Status legend: `Not started` · `In progress` · `In review` · `Done` · `Blocked`

---

## Task 1 — OAuth third-party login (Google + Microsoft) via Supabase

- **Owner:** Eyad (`eyademad1`)
- **Status:** Not started
- **Depends on:** nothing new — `SupabaseService` (Supabase client) and the
  local JWKS JWT guard already exist and are merged on `dev`.

### Context

EduAI already has email/password auth:
- `POST /auth/signup` — creates a Supabase user via `auth.admin.createUser`
  and a local `User` row linked by `authId`.
- `POST /auth/login` — `auth.signInWithPassword`, returns the Supabase
  `access_token` + local user.
- `GET /auth/me`, `POST /auth/logout` — `auth.admin.signOut(authId)`.
- `AuthGuard` (`src/auth/auth.guard.ts`) verifies every Bearer token locally
  via JWKS (RS256/ES256, `SupabaseService.verifyToken`) and resolves the
  local `User` by `authId`. **Any token Supabase issues for an OAuth session
  is a regular Supabase JWT, so this guard works with OAuth sessions with
  zero changes.**

Hard constraint from `specs.md` §2: the frontend **never talks to Supabase
directly** — every auth flow must be proxied through the backend REST API.
That means OAuth must be a backend-mediated flow (back-end initiated URL +
back-end code exchange), not the frontend calling `supabase.auth.signInWithOAuth`.

### Goals (endpoints to implement in `src/auth/`)

1. `GET /auth/providers` — `@Public()`. Returns the enabled third-party
   providers, e.g. `{ providers: [{ provider: 'google', enabled: true },
   { provider: 'microsoft', enabled: true }] }`. Source of truth: an env
   allowlist (`OAUTH_PROVIDERS=google,microsoft`) or the Supabase config;
   keep it simple — read from env, default `google,microsoft`.
2. `POST /auth/oauth/:provider/authorize` — `@Public()`. Validates the
   provider is in the allowlist, then calls
   `supabase.auth.signInWithOAuth({ provider, options: { redirectTo:
   \`${API_URL}/auth/oauth/callback\` } })` and returns `{ url }` — the
   provider's authorization URL. The frontend redirects the browser there.
   Use `API_URL` from env (fall back to the request origin).
3. `GET /auth/oauth/callback` — `@Public()`. Receives the provider redirect
   (`?code=...` or `?error=...`):
   - `error` present → fail with `400` (provider declined/denied).
   - Otherwise `supabase.auth.exchangeCodeForSession(code)`.
   - Resolve the local user, in this order:
     1. by `authId` (existing OAuth user), else
     2. by `email` (links accounts created via `seed.ts`/signup — e.g. a
        seeded `student@eduai.test` logging in with Google if the same email
        was used for the OAuth app), else
     3. create a new local `User` with role `STUDENT`, `name` from the
        provider profile (`user_metadata.full_name` / `name`), `authId`
        set. **Decision to confirm with the product owner:** default role
        for brand-new OAuth users (`STUDENT` recommended — teachers register
        via the email/password signup path, admins change roles).
   - Respond by redirecting to the frontend with the session in the URL
     fragment (never in the query string — fragments never hit server logs):
     `302 → ${FRONTEND_URL}/auth/callback#access_token=...&refresh_token=...`
     (`FRONTEND_URL` from env; fail with 500 if unset). The frontend reads
     the fragment and stores the tokens; subsequent API calls are plain
     `Authorization: Bearer <access_token>` requests.
4. `POST /auth/refresh` — `@Public()`. Body `{ refreshToken }` →
   `supabase.auth.refreshSession({ refresh_token })` → return
   `{ accessToken, refreshToken }`. Keep the existing error semantics
   (401 on invalid/expired refresh token).
5. Extend `POST /auth/logout` — already exists; verify it also revokes an
   OAuth-issued session (it uses `auth.admin.signOut(authId)` — no change
   expected, just confirm).

### Files to create/modify

- `src/auth/auth.controller.ts` — new routes (providers, authorize,
  callback, refresh).
- `src/auth/auth.service.ts` — `getProviders()`, `getOauthAuthorizeUrl()`,
  `handleOauthCallback(code)` (exchange + user upsert/link/create),
  `refresh(refreshToken)`.
- `src/auth/supabase.service.ts` — add thin wrappers only if needed
  (`exchangeCodeForSession`, `refreshSession`); the client is already
  exposed via `getClient()`.
- `src/auth/dto.ts` — Zod schemas: `RefreshSchema` (`refreshToken:
  string.min(1)`), `OauthAuthorizeParams` (provider enum
  `google|microsoft`), response DTOs.
- `src/auth/auth.service.spec.ts` + `src/auth/auth.controller.spec.ts` —
  new specs (see Tests).
- `.env.example` — document `OAUTH_PROVIDERS`, `API_URL`, `FRONTEND_URL`.

### External setup (one-time, human + Supabase dashboard — not code)

- **Google:** create an OAuth client in Google Cloud Console (Web
  application); authorized redirect URI must be
  `https://<project-ref>.supabase.co/auth/v1/callback`. Copy Client ID +
  Client Secret into Supabase Dashboard → Authentication → Providers →
  Google.
- **Microsoft:** register an app in Microsoft Entra ID (supported account
  types: single tenant or personal — pick per product need); same Supabase
  redirect URI; copy Tenant/Client ID + Client Secret into Supabase
  Dashboard → Authentication → Providers → Microsoft.
- Both providers are then served by Supabase; the backend code above just
  initiates and exchanges the flow.

### Edge cases to handle

- `authorize` with a provider not in the allowlist → `400`.
- Callback without `code` and without `error` → `400`.
- Code exchange failure / invalid code → `401` (never a 500).
- OAuth user whose email matches an existing local user → link by email and
  **keep the existing role** (do not downgrade to STUDENT).
- Two concurrent OAuth logins with the same email → no duplicate local
  users (`email` is `@unique`; use a find-then-create with the unique
  conflict in mind, or a short transaction).
- Tokens must never be logged, and must never appear in the query string
  (fragment only).

### Tests (required)

- `AuthService.handleOauthCallback`: links by `authId`, links by `email`
  (role preserved), creates new user with default role, throws 401 on
  exchange failure, throws 400 when `error` param present.
- `AuthService.refresh`: returns new tokens on success, throws 401 on
  failure.
- `AuthController.authorize`: valid provider returns `{ url }`; invalid
  provider → 400.
- `GET /auth/providers`: returns the env-configured allowlist.
- Mock `SupabaseService` (the same pattern as the existing specs — jest
  mocks for `signInWithOAuth`, `exchangeCodeForSession`, `refreshSession`).
- No new end-to-end test required (provider round-trip needs real OAuth
  credentials); document manual verification steps in the PR description.

### Acceptance criteria

- [ ] A user can complete a Google login end-to-end (authorize → provider →
  callback → local user resolved/created → fragment redirect).
- [ ] The same flow works for Microsoft.
- [ ] A seeded account (`teacher@eduai.test` etc.) logging in via OAuth
  with the same email keeps its role and links by `authId`.
- [ ] An existing Bearer token issued by the OAuth flow passes
  `AuthGuard` unchanged (no guard changes).
- [ ] Refresh and logout work for OAuth sessions.
- [ ] All tests above exist and pass; `lint` + `test` + `build` clean.

---

## Task 2 — Store material PDFs in Supabase Storage (replace current upload flow)

- **Owner:** Eyad (`eyademad1`)
- **Status:** Not started
- **Depends on:** nothing new — `SupabaseService.getClient()` already
  returns a `SupabaseClient` with the Storage API available.

### Context

Today `MaterialsService.upload()` (`src/materials/materials.service.ts`):
1. Receives the file buffer (multer `memoryStorage()`, 10 MB limit —
   `src/materials/materials.controller.ts`).
2. Extracts text with `pdf-parse` (or treats the buffer as UTF-8 text).
3. Chunks the text, creates `Material` + `MaterialChunk` rows, embeds each
   chunk (pgvector).
4. **Discards the original file** — it is never persisted anywhere. The
   `Material.fileUrl` column just stores the original filename
   (`fileUrl: filename`), which is misleading: there is no URL and no file
   behind it.

`delete()` removes only the DB row; the file (which doesn't exist) is
ignored. The old `uploads/` directory and `MulterModule.register({ dest:
'./uploads' })` were already removed — do not reintroduce disk storage.

### Goal

Persist the original PDF in a Supabase Storage bucket so teachers/students
can download the source document, not just the extracted text.

### Design (decisions already made)

1. **Bucket:** env var `SUPABASE_STORAGE_BUCKET` (default `materials`).
   The bucket must exist in Supabase Storage and be **private**; access is
   via signed URLs generated by the backend (keeps access control inside
   our API). Service role key bypasses RLS, so no policy work is needed for
   the upload itself.
2. **Object path (stable + namespaced):** `materials/{classId}/{materialId}.pdf`
   — create the `Material` row first (you need its id), then upload the
   buffer, then update `Material.fileUrl` with the object path (no migration
   needed — reuse the existing `fileUrl String?` column; it now holds the
   storage path, not a filename).
3. **Download endpoint:** `GET /materials/:id/file` — `@Roles('TEACHER',
   'STUDENT', 'GUARDIAN', 'ADMIN')`; load the material, verify the caller
   belongs to its class (teacher of class / student enrolled / guardian of
   enrolled student — reuse the existing access patterns in
   `MaterialsService`/`StudentsService`), then return a short-lived signed
   URL via `supabase.storage.from(bucket).createSignedUrl(path, 3600)`.
   Respond with `{ url }` (the frontend opens it) — don't stream the file
   through the API in MVP.
4. **Upload flow:** parse the text first (as today); if text extraction
   succeeds, create the row + upload the file; if the storage upload fails,
   **fail the whole request** (`502`) and delete the just-created row —
   never persist a material whose source file is missing.
5. **Delete flow:** on `MaterialsService.delete()`, also
   `supabase.storage.from(bucket).remove([path])` (best-effort: log and
   continue if the object is already gone), then delete the row.
6. **Non-PDF uploads** (plain text files) keep current behavior (no bucket
   upload, `fileUrl` stores the filename as today).

### Files to create/modify

- `src/materials/materials.service.ts` — inject `SupabaseService`, upload
  to bucket, update `fileUrl` with the object path, add
  `getMaterialFileUrl(id, user)` (signed URL + class-scope check),
  delete from bucket on `delete()`.
- `src/materials/materials.controller.ts` — add `GET :id/file` route with
  `@Roles(...)` and Swagger annotations (mirror the existing route style).
- `src/materials/materials.module.ts` — import `AuthModule` if needed for
  `@Roles` (check whether it already is).
- `src/materials/materials.service.spec.ts` — extend (see Tests).
- `.env.example` — document `SUPABASE_STORAGE_BUCKET`.

### External setup (one-time, human)

- Create the `materials` bucket in Supabase Storage (Dashboard or via a
  script with the service key). Private bucket. No RLS policy needed for
  MVP (service role used server-side).

### Tests (required)

- Upload success: storage `upload` called with the right bucket/path +
  buffer; `fileUrl` ends with the object path.
- Upload failure (storage rejects): request fails (`502`), the created
  `Material` row is deleted (rolled back), and a sensible error surfaces.
- `GET /materials/:id/file`: returns a signed URL for a material the user
  may access; `403`/`404` for a material outside the caller's class scope;
  `404` for missing material.
- `delete`: storage `remove` called with the stored path; `delete` on a
  material with no stored path skips storage gracefully.
- Mock the storage client (`supabase.storage.from(bucket).upload /
  .createSignedUrl / .remove`) — same jest-mock pattern as the existing
  specs.

### Acceptance criteria

- [ ] Uploading a PDF stores the original file in the `materials` bucket
  and the object path in `Material.fileUrl`.
- [ ] `GET /materials/:id/file` returns a working signed download URL,
  scoped to the caller's class access.
- [ ] Deleting a material removes both the row and the bucket object.
- [ ] Storage failure never leaves a material without its file.
- [ ] All tests above exist and pass; `lint` + `test` + `build` clean.

---

## Task 3 — Teacher↔Student chat (triggered by the homework helper)

- **Owner:** Alaa
- **Status:** Not started
- **Depends on:** nothing new — `SupabaseService.verifyToken` (JWT auth), the
  class/teacher/`Approved`-enrollment scope checks, and the
  `HOMEWORK_HELP_REDIRECT` notification all exist on `dev`.

### Context

When the homework helper can't answer a student's question it returns
`REDIRECT_TEACHER`, and `HomeworkHelperService.help()` calls `notifyTeacher()`
(`src/homework-helper/homework-helper.service.ts`) — the class teacher gets a
`Notification` (`HOMEWORK_HELP_REDIRECT`) but has no way to actually talk to
the student. This task adds a real-time, DB-persisted chat between the student
and the class teacher, created at that instant: the redirect triggers the
session, both parties get a notification deep-linking into it, and they can
chat in real time.

### Decisions (already made — product owner confirmed)

1. **Transport: socket.io.** Bidirectional WebSocket with rooms per session;
   the JWT is sent in the handshake (`auth.token`), never in a URL query
   string. Adds `@nestjs/websockets`, `@nestjs/platform-socket.io`,
   `socket.io` (+ `socket.io-client` devDep for manual verification).
2. **Session lifecycle: one persistent thread per (student, teacher, class).**
   `@@unique([studentId, teacherId, classId])`; a later redirect reuses and
   reopens the same session. History stays available like an inbox.
3. **Both parties are notified.** Teacher: `HOMEWORK_HELP_REDIRECT` (as today)
   + new `CHAT_READY` for the student, both carrying `Notification.entityId` =
   the session id so the frontend deep-links straight into the chat.
4. **Trigger-only creation.** Sessions are created only by
   `REDIRECT_TEACHER`. No manual create endpoint in MVP — students/teachers
   cannot open threads on their own (easy to add later).

### Design

1. **Schema** (migration name `chat_sessions`):
   - `ChatSession` — `id`, `studentId`, `teacherId`, `classId`,
     `status` (`ChatSessionStatus` enum: `OPEN | CLOSED`), `createdAt`,
     `updatedAt`; relations `student`/`teacher` → `User`,
     `class` → `Class`, `messages` → `ChatMessage[]`;
     `@@unique([studentId, teacherId, classId])`.
   - `ChatMessage` — `id`, `sessionId`, `senderId`, `content`, `readAt?`,
     `createdAt`; `@@index([sessionId, createdAt])`; `onDelete: Cascade`
     from the session.
   - `Notification.entityId String?` — nullable, reused for deep links
     (no new table).
2. **`src/chats/` module** (new): `chats.module.ts`, `chats.service.ts`,
   `chats.controller.ts`, `chats.gateway.ts`, `dto.ts`, specs. Register in
   `src/app.module.ts`.
3. **`ChatsService`** — the single source of truth for scope rules; REST and
   the gateway both call it:
   - `ensureSession({ studentId, teacherId, classId })` — validates the
     teacher owns the class (`class.teacherId`) **and** the student has an
     `APPROVED` enrollment in it (reuse the enrollment patterns from
     `classes`/`enrollments` modules); find-or-create the
     `(student, teacher, class)` thread, reopening it if `CLOSED`.
   - `listSessions(userId)` — sessions where user is `studentId` or
     `teacherId`, with last message + unread count.
   - `getSession(sessionId, userId)` — `404` if missing, `403` if the user is
     not a participant; includes messages (ascending) + participant names.
   - `sendMessage(sessionId, senderId, content)` — membership check, persist,
     return the message row.
   - `markRead(sessionId, userId)` — set `readAt` on all messages from the
     other participant where `readAt IS NULL`.
   - `close(sessionId, teacherId)` — teacher only; sets `status = CLOSED`.
4. **`ChatsController`** (REST, existing `AuthGuard`/`RolesGuard` +
   `@CurrentUser`):
   - `GET /chats` — current user's sessions.
   - `GET /chats/:id` — session + messages (participant only).
   - `POST /chats/:id/messages` — body `{ content }` (participant only);
     persists and emits `message:new` through the gateway.
   - `PATCH /chats/:id/read` — mark read.
   - `PATCH /chats/:id/close` — `@Roles('TEACHER')` only.
   - Zod schemas in `src/chats/dto.ts` (`ContentSchema`: `content: string
     min(1)` etc.) following the existing dto conventions.
5. **`ChatsGateway`** (socket.io):
   - Handshake auth: read the token from the `auth` payload
     (`socket.handshake.auth.token`), `SupabaseService.verifyToken(token)`,
     resolve the local `User` by `authId`, attach to `socket.data.user`;
     reject the connection (`UnauthorizedException`) otherwise. The HTTP
     `AuthGuard` does not apply to sockets — this is the same verification
     logic, duplicated deliberately (extract a small shared helper if clean).
   - Events: `chats:join` (`{ sessionId }` — membership check, then
     `socket.join('session:' + sessionId)`); `message:new`
     (`{ sessionId, content }` → `sendMessage()` → broadcast to the room);
     server → client `message:new` payload = the persisted message row.
   - `cors: true` mirroring `app.enableCors()`; no namespace needed for MVP.
6. **Homework-helper wiring**
   (`src/homework-helper/homework-helper.service.ts`):
   - `notifyTeacher()` becomes: resolve class + student (as today) →
     `chatsService.ensureSession(...)` → `notifyUser(teacherId,
     'HOMEWORK_HELP_REDIRECT', ...)` with `entityId: session.id` →
     `notifyUser(studentId, 'CHAT_READY', ...)` with `entityId: session.id`.
   - Inject `ChatsService` via `ChatsModule` (export it).
7. **Notifications** (`src/notifications/`): `notifyUser()` gains an optional
   `entityId?: string` parameter persisted on the row; `NotificationDto`
   exposes it.

### Files to create/modify

- `prisma/schema.prisma` — `ChatSession`, `ChatMessage`, `ChatSessionStatus`
  enum, `Notification.entityId`, relations on `User`/`Class`.
- `src/chats/` — new module: `chats.module.ts`, `chats.service.ts`,
  `chats.controller.ts`, `chats.gateway.ts`, `dto.ts`, `chats.service.spec.ts`,
  `chats.controller.spec.ts` (see Tests).
- `src/homework-helper/homework-helper.service.ts` — wire `ensureSession` +
  dual notifications with `entityId`; update its spec.
- `src/notifications/notifications.service.ts` + `dto.ts` — optional
  `entityId` passthrough; update the spec.
- `src/app.module.ts` — register `ChatsModule`.
- `package.json` — `@nestjs/websockets`, `@nestjs/platform-socket.io`,
  `socket.io`; devDep `socket.io-client` (manual verification).
- `TASKS.md` — this entry (already written).

### Scope rules (non-negotiable)

- Only teacher ↔ students **APPROVED-enrolled in that teacher's classes**.
  Both directions are enforced inside `ChatsService` — no other place may
  touch sessions or messages.
- Chat content never reaches an LLM — no PII concern, but keep the PII rule
  in mind if any future feature summarizes chat.

### Out of scope (MVP)

Typing indicators, media/attachments, FCM push, multi-teacher classes,
manual session creation, chat export.

### Tests (required)

- `ChatsService.ensureSession`: creates on first redirect; reuses + reopens
  an existing `CLOSED` thread; throws `403` when the teacher doesn't own the
  class; throws `403` when the student has no `APPROVED` enrollment.
- `ChatsService.getSession` / `sendMessage` / `markRead`: `404` on missing
  session; `403` for a user who is neither participant; `sendMessage`
  persists the row with `senderId`; `markRead` only touches the other
  participant's unread messages.
- `ChatsService.close`: teacher closes → `CLOSED`; a student close → `403`.
- `ChatsController`: `GET /chats/:id` returns messages; `POST
  /chats/:id/messages` returns 201 + the message; non-participant → 403;
  invalid body → 400 (mock `ChatsService`).
- `HomeworkHelperService`: on `REDIRECT_TEACHER`, `ensureSession` called and
  both notifications created with `entityId` = session id; update existing
  specs for the new `notifyUser` signature.
- Gateway: unit-test the handshake auth helper (valid token resolves the
  user; invalid/expired → connection rejected) with mocked `SupabaseService`;
  no end-to-end socket test required — document manual verification with
  `socket.io-client` in the PR description.
- `lint` + `test` + `build` clean.

### Acceptance criteria

- [ ] A `REDIRECT_TEACHER` answer creates (or reopens) the
  `(student, teacher, class)` session; teacher and student both get a
  notification whose `entityId` deep-links to it.
- [ ] Teacher and student exchange messages in real time (socket.io);
  messages are persisted and reloadable via `GET /chats/:id`.
- [ ] A student cannot read/send in any session that isn't theirs; a teacher
  cannot see students outside their classes; non-enrolled students are
  rejected at session creation.
- [ ] Mark-read and teacher-close work; closed sessions reopen on a new
  redirect.
- [ ] All tests above exist and pass; `lint` + `test` + `build` clean.

---

## Task 4 — Dashboard insights (backend half of a shared backend/frontend task)

- **Owner:** Abdallah (taken over from Ahmed Selim — Ahmed unavailable)
- **Status:** In progress
- **Depends on:** nothing new — the dashboard module, agents' persisted
  outputs (`StudentAnalysis`, `StudentReport`, `HomeworkHelpInteraction`),
  and the confirmed-grade rule all exist on `dev`.
- **Frontend half:** tracked separately in
  `docs/dashboard-insights-frontend.md` (handoff: endpoints, payloads,
  chart-type contract, Recharts mapping). The frontend renders whatever the
  backend declares — it never picks chart types or computes trends itself.

### Context

`GET /dashboard/overview` (src/dashboard/) returns point-in-time snapshots
(counts + recent lists) — no time series, no up/down trends, and none of the
insights the agents already produce (`StudentAnalysis.diagnosis /
teacherContent / guardianContent`, `StudentReport` parent/teacher/management
sections, `HomeworkHelpInteraction` action split). The goal of this shared
task: **graphs everywhere** — trends going up and down, distributions, and
agent narratives, for every role, in a shape the frontend can render without
any math or chart-selection logic.

### Decisions (already made — product owner confirmed)

1. **New `GET /dashboard/insights` endpoint** (role-aware) — `overview`
   stays untouched so its frontend contract doesn't break.
2. **Backend owns the chart type.** Every series in the response carries
   `chartType: 'line' | 'area' | 'bar' | 'radar' | 'donut'`; the frontend
   maps `chartType` → Recharts component and renders. Zero chart-selection
   logic client-side.
3. **Server computes deltas** — `{ deltaPercent, direction: 'up'|'down'|
   'flat' }` accompanies `line`/`area` series only (current period vs
   previous equal-length period). `radar`/`donut` carry no delta.
4. **All grade statistics use `isConfirmed = true` rows only** (§4 hard
   rule). Unconfirmed suggestions never feed a trend.
5. **Interval:** `?interval=week|month` query param, default `week`,
   returning the last 12 buckets (12 weeks or 12 months).
6. **Excluded from this task:** quiz and chat insights (quiz models are
   absent from the local schema checkout; chat depends on Task 3). Add them
   in a follow-up task when their data is present.
7. **Per-student drill-down:** `GET /dashboard/insights/students/:id`
   (STUDENT self, TEACHER own classes, GUARDIAN own wards, ADMIN).
8. **`/dashboard/overview` is untouched** — no changes to its shape or its
   existing specs.

### Design

1. **Pure helpers** — `src/dashboard/insights.util.ts` (plain functions,
   unit-testable per specs §8):
   - `bucketize(rows, interval, buckets)` → `{ label, value }[]` with
     day/week/month boundary math (labels as ISO date of bucket start).
   - `computeDelta(current, previous)` → `{ deltaPercent, direction }`
     (direction `'flat'` when values are 0 or equal; never divide by zero).
   - `avgPercentage(scores)` → rounded class/student average across
     criteria (confirmed only).
2. **`src/dashboard/insights.service.ts`** — role dispatch + section
   builders, injected into `DashboardModule`. Response shape:

   ```ts
   {
     interval: 'week' | 'month',
     sections: [{
       key: string,        // stable id for the frontend grid
       title: string,      // human-readable, backend-written
       chartType: 'line' | 'area' | 'bar' | 'radar' | 'donut',
       series: [{ label: string, value: number }],
       delta?: { deltaPercent: number, direction: 'up' | 'down' | 'flat' },
     }],
     agentInsights: [...], // narrative lists, role-specific (see below)
     unreadNotifications: number,
   }
   ```

3. **Per-role sections** (all series bucketed, deltas on trends):

   | Role | `chartType` sections | `agentInsights` lists |
   |---|---|---|
   | TEACHER | `area` submissions/week; `line` confirmed/week; `line` pending confirmations/week; `area` alerts created/week + resolved/week; `line` attendance rate/week; `bar` per-class average; `radar` per-criterion average % (all classes); `bar` homework-help `REDIRECT_TEACHER` count/week per top-5 students | latest `StudentAnalysis` per flagged student (`teacherContent`); latest `StudentReport.teacherSection`; homework-help redirects with question text |
   | STUDENT | `line` confirmed-grade percentage over time; `line` attendance rate/week; `radar` per-criterion strength/weakness; `donut` homework-help action split (HINT/EXPLANATION/REDIRECT_TEACHER) | own active alerts (type + reason); latest own `StudentReport` summary |
   | GUARDIAN | per child: `line` grade percentage over time; `line` attendance rate/week; `area` alerts created/week | per child: latest `StudentReport.parentSection` + `StudentAnalysis.guardianContent` |
   | ADMIN | `area` submissions/week; `line` confirmed/week; `line` pass-rate trend; `area` alerts created/week; `bar` user growth (students/teachers by bucket); `bar` per-teacher workload (pending confirmations + students); `donut` alert status split (ACTIVE/RESOLVED/DISMISSED) | latest `StudentReport.managementSummary` per recent report; teacher summaries (avg + pending) |

   Scoping (same access patterns as `overview`): teacher → classes where
   `class.teacherId`; student → self; guardian → `wards` only; admin → all.
   A `bar` comparison of per-class/per-teacher values uses series
   `{ label: <name>, value: <number> }`.
4. **Drill-down** `GET /dashboard/insights/students/:id` — same section
   builders scoped to one student; teacher must teach a class the student
   is `APPROVED`-enrolled in, guardian must be the ward's guardian, student
   only self; otherwise `403`.
5. **Controller** — `src/dashboard/dashboard.controller.ts` adds the two
   routes with `@Roles(...)` + Swagger; zod DTOs for the responses added to
   `src/dashboard/dto.ts` (same pattern as the existing ones).
6. **Caveat to verify at implementation time:** the local
   `prisma/schema.prisma` on this checkout has no Quiz models while
   `homework-helper` references `prisma.quizAttempt` — confirm on `dev`
   whether the build is green before starting (not this task's job to fix).

### Files to create/modify

- `src/dashboard/insights.util.ts` — new (pure helpers).
- `src/dashboard/insights.service.ts` — new (sections + agent insights).
- `src/dashboard/insights.util.spec.ts` + `src/dashboard/insights.service.spec.ts`
  — new specs (see Tests).
- `src/dashboard/dashboard.service.ts` — untouched (overview stays as-is).
- `src/dashboard/dashboard.module.ts` — register `InsightsService`.
- `src/dashboard/dashboard.controller.ts` — two new routes + Swagger.
- `src/dashboard/dto.ts` — insights response schemas + `InsightsQuerySchema`
  (`interval` enum, default `week`).
- `src/dashboard/dashboard.controller.spec.ts` — extend for the new routes.
- `docs/dashboard-insights-frontend.md` — the frontend handoff (already
  written in this task; keep it in sync with the final DTOs).

### Tests (required)

- `insights.util.spec.ts`: `bucketize` boundaries across week/month with
  empty and single-point data; `computeDelta` up/down/flat, zero values
  (no division by zero), equal values → `'flat'`; `avgPercentage` rounding
  and empty input → 0.
- `insights.service.spec.ts` (mock `PrismaService`):
  - TEACHER: sections scoped to own classes; confirmed-only filter
    (`isConfirmed: false` rows never counted); deltas compare current vs
    previous bucket window; `agentInsights` includes only own-class
    students.
  - STUDENT: self-scoped; donut action split matches interaction rows.
  - GUARDIAN: only own wards; per-child sections match ward data.
  - ADMIN: school-wide counts; per-teacher workload excludes unconfirmed
    scores.
  - Drill-down: valid teacher/guardian/admin access returns scoped
    sections; non-teaching teacher → `403`; student on someone else's id
    → `403`.
- `dashboard.controller.spec.ts`: `GET /dashboard/insights` returns
  sections; `?interval=month` honored; invalid interval → `400`; roles
  enforced (mock `InsightsService`).
- `lint` + `test` + `build` clean.

### Acceptance criteria

- [ ] `GET /dashboard/insights` returns role-scoped, bucketed sections with
  `chartType` + deltas for all four roles; every grade-based number comes
  only from confirmed rows.
- [ ] `GET /dashboard/insights/students/:id` enforces scope (403 outside
  it) and reuses the same section builders.
- [ ] `?interval=week|month` works; invalid values → 400.
- [ ] `agentInsights` surfaces `StudentAnalysis`, `StudentReport`, and
  `HomeworkHelpInteraction` content per role.
- [ ] `GET /dashboard/overview` unchanged — existing specs untouched and
  passing.
- [ ] `docs/dashboard-insights-frontend.md` documents every section key,
  the `chartType` → Recharts mapping, and the delta badge rules.
- [ ] All tests above exist and pass; `lint` + `test` + `build` clean.
