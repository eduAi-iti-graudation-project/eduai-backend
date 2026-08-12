# EduAI Tasks

## Completed: Meetings join fix (2026-08-09)

- Guest: `POST /meetings/:id/join` 500'd because `.env` carried placeholder LiveKit creds (`wss://dev.example.livekit.cloud` / `devkey` / `devsecret_...`) that `LivekitService.isConfigured()` treated as real config → phantom API calls.
- `LivekitService` now also rejects dev/local placeholder values (isConfigured=false), and egress (RoomEgress/AutoTrack) is only attached when the Supabase S3 block is present (`isStorageConfigured()`) — recording-enabled rooms no longer fail to create when S3 creds are missing; `startRecording`/`stopRecording` no-op with a warning instead of throwing.
- `.env`: real `LIVEKIT_URL=wss://eduai-dczlzhyd.livekit.cloud` + `LIVEKIT_API_KEY=APIMyNhAPuFFSAV` (secret still placeholder — user must paste the cloud API secret), commented S3 egress block added.
- Found + fixed stale-server trap: an old `npm run start:dev` watcher held port 3000 with stale dist, producing EADDRINUSE and misleading 500s after rebuilds — killed watcher, serve `node dist/src/main.js` directly.
- New `livekit.service.spec.ts` (placeholder/config/startRecording guards). 697 backend tests green; verified live: create AD_HOC → join 201 (token + livekit URL) → end 200.

## Completed: Grades/classes console + migration endpoints (2026-08-09)

- `classes` module: `/classes` CRUD + enrollments + `POST /classes/:id/teacher` (teacher assignment = offering upsert on the section's first course in its grade, matching how offerings carry teachers). Decorates responses with `teacherId` from the first offering.
- `grade-console` module: `GET/POST /grades`, `GET/POST /grades/:gradeId/classes`, `DELETE /grades/:gradeId/classes/:classId` (re-links a class to a grade / deletes it), reusing `GradeLevelsService` + `ClassesService`.
- Migration: `POST /migration/csv/analyze-pasted` (TSV paste path, `MigrationService.analyzePasted`) + `GET /migration/csv/template` (CSV matching the wizard's deterministic-header path).
- 689 backend tests / 61 suites; live-verified: grade-10 class list w/ teacher, grade create 201, pasted-TSV mapping, template short-circuit.

## Active: W1 — Fix attachments end-to-end

The teacher-uploaded attachment is broken today:

1. Frontend `getMaterials()` calls `/materials/class/{id}`, backend serves `/materials/offering/{courseOfferingId}` → 404
2. `GET /materials/:id/file` (signed URL) exists but is never called; teacher "View" button links the raw storage path
3. Students have zero access to materials — no assignment↔material link, nothing in the student UI

---

## Latest: Demo pipeline — communication agent + remediation (2026-08-09)

Done:
- Seed: org `TRIALING`/`ENTERPRISE` (agent no longer skips); 4 new assignments (poetry, literary analysis, trigonometry, mechanics) + rubrics 205–208 confirmed; confirmed ≥60% submissions for Sara, Omar, Ethan, Liam, Ava, Noor, Zoe; Sam's poetry submission `…0323` (SUBMITTED 48%) is the demo trigger; 15 school days of attendance × 20 student-section pairs.
- `StudyGeneration.recommendedForAnalysisId` (migration `20260809091353_study_generation_recommendation`) linking practice sets to analyses.
- `StudyLabService.recommend()` — creates PRACTICE_QUESTIONS generation tied to an analysis (dedupes PROCESSING/READY); **zero-chunk hard error removed** (warn + ungrounded generation instead).
- `CommunicationAgentService` — LLM calls wrapped in `safeStructured` with deterministic fallback (explanation/teacher/guardian content always produced → alert + teacher/guardian/student notifications always fire even if the LLM is down); after analysis creation it calls `recommendPractice()` (weak crit/concern topic → StudyLab) and notifies the student; `analyze()` skips submissions already analyzed (no duplicate alerts on re-confirm).
- `StudyLabModule` now exports `StudyLabService`; communication-agent module imports it.
- `AlertsService.getTeacherDetail` returns `recommendations` (generations for the analysis).
- **Security**: `GET /notifications` now scoped to the authenticated user (previously a plain `userId` query param — anyone could read anyone's notifications); frontend `getNotifications()` no longer passes userId.
- Generators: practiceSet has an ungrounded mode when no curriculum chunks exist (the OSS chat model refused empty-corpus prompts).
- Tests: 672/672 green.

Demo flow: teacher console → Poetry essay scores confirm → agent flags Sam (FAILING), notifies teacher/guardian/student, generates recommended practice (READY) visible in student Study Lab ("Recommended practice") and teacher alert detail.

Planned (future): W6 grading-adapts-to-type (see below).

### Steps

- [x] Backend: add optional `assignmentId` to `Material` (prisma schema + migration)
- [x] Backend: `uploadMaterial` associates the file with the assignment (controller/service/DTO)
- [x] Backend: list materials by assignment (`GET /materials/assignment/:assignmentId`) with enrollment-scoped access check
- [x] Frontend: fix `getMaterials()` route drift `/materials/class` → `/materials/offering` (`lib/api.ts` vs `materials.controller.ts`)
- [x] Frontend: add `getMaterialFileUrl(id)` wrapper for the signed-URL endpoint
- [x] Frontend: student assignment list shows attachments with working download (signed URL)
- [x] Frontend: fix teacher `ClassDetailPage` "View" button to use the signed URL
- [x] Build + tests green (backend `npm run build`, `npm test` 630/630; frontend `tsc`, `npm run build`)

## Active: W2 — Chapter-based material organization (C: hybrid auto + manual)

Materials were a flat, unchunked file list. Chapters give structure: auto-detected from uploaded documents, then teacher-managed.

- [x] Schema: `MaterialChapter` (courseOfferingId, title, order) + `Material.chapterId` (nullable) + migration `materials_chapters`
- [x] Chapter detector (`chapter-detector.ts`): heading heuristics (`Chapter|Unit|Lesson|Module|Part|Section|Topic N`, roman/word numerals), TOC skip via dot-leader + dense-cluster rules, repeat-heading dedupe — no LLM pass
- [x] `upload` auto-creates chapters when ≥2 headings detected (order from max), links file to first chapter, returns `detectedChapterCount`; explicit `chapterId` upload skips detection
- [x] Chapter CRUD: `POST /materials/chapters`, `PATCH /materials/chapters/:id` (title/order), `DELETE /materials/chapters/:id` (files → ungrouped via `SetNull`)
- [x] Move file: `POST/DELETE /materials/chapters/:id/materials/:materialId` (link/unlink, same-class validation)
- [x] Grouped listing `GET /materials/chapters/offering/:courseOfferingId` → `{ chapters: [{..., materials}], unassigned }`
- [x] `searchChunks` / `searchChunksByCourse` gain optional `chapterId` filter + `chapterTitle` via LEFT JOIN; homework-helper & quiz search-curriculum tools spell the chapter in results
- [x] Teacher UI (`ClassMaterialsTab`): chapters accordion, create/rename/delete, reorder (arrows + drag), drop PDFs onto a chapter (queued upload with chapterId), bulk multi-file upload, drag material chips between chapters; DB/confirmation toasts
- [x] Student UI: `StudentMaterialsPage` at `/student/classes/:classId/materials` (linked from class page) — chapters, per-file signed-URL downloads, unassigned "General" section
- [x] Tests: detector spec (4), upload-with-chapters spec, chapters CRUD spec, controller route spec — 655/655 green; frontend `tsc` + `eslint` + `build` clean

## Active: W3 — Grade-based auto-enrollment (remove join request flow)

Students are auto-enrolled in ALL offerings of their grade — no join button, no teacher approval. Teachers keep remove/re-add with a persistent exclusion (REJECTED marker).

- [x] New `RosterModule` + `EnrollSyncService`: `syncStudentToGrade` (enrolls in all grade sections minus exclusions, removes APPROVED rows in other-grade sections), `syncSectionToStudents` (enrolls all non-excluded students of a section's grade); both tx-aware
- [x] `sections.service`: `create()` syncs section students; `addEnrollment` re-add clears exclusion (REJECTED → APPROVED); `removeEnrollment` persists REJECTED instead of deleting
- [x] Sync hooks: `students.service.update` on grade change, `offerings.service.create` after offering creation, `join-requests` approveOne enrolls via grade (replaces direct enrollment create)
- [x] Removed `GET /classes/available`, `POST /classes/:id/join`, `GET /classes/:id/requests`, `PATCH /enrollments/:id/approve|reject`; deleted `enrollments/` module + `EnrollmentsModule` registration
- [x] Specs: `roster/enroll-sync.service.spec.ts` (7 tests: grade enroll, skip excluded/enrolled, grade-change removal, no-ops, section sync, exclusion persistence); join-requests + students specs updated for new constructor deps — 662/662 green
- [x] Frontend: removed `joinClass`/`getClassRequests`/`approveEnrollment`/`rejectEnrollment`/`getAvailableClasses` from `lib/api.ts`; `AvailableClassesPage` → read-only auto-list; `ClassDetailPage` Requests tab + badge removed
- [x] Frontend `tsc` + `eslint` + `build` clean

## Planned: W2.5 — Per-chunk chapter mapping (true intra-document split)

v1 links a whole file to one chapter (book → first chapter, rest are scaffolds). For per-chapter *content* of a single big file:

- [ ] `MaterialChunk.chapterId?` from detected header offsets (`startLine`) at upload time
- [ ] `searchChunks(..., chapterId)` filters via chunk chapter; student chapter views list materials whose *chunks* live there
- [ ] Optional: split-into-parts signed URLs (byte-range) per chapter for "read chapter 3 of the book"

## Planned: W4 — Assignment types (subject-aware creation)

Per-assignment type picker in the creation form:

- [ ] `Assignment.type` enum: `ESSAY` | `PROBLEM_SET` | `PROGRAMMING` | `PRACTICAL` (default `ESSAY`) + migration
- [ ] Creation form step 1: type picker cards with icons
- [ ] Step 2 rubric adapts per type with criterion template presets:
  - `PROBLEM_SET`: Method / Calculations shown / Final answer / Units-precision
  - `PROGRAMMING`: Correctness / Edge cases / Code quality / Requirements met
  - `PRACTICAL`: Procedure / Results / Analysis / Conclusion
  - `ESSAY`: current free-form
- [ ] Rubrics stay mandatory for every type (differentiator vs MCQ; quizzes stay separate)

## Planned: W5 — File-capable submissions

- [ ] `Submission` gains `fileUrl?`, `fileName?`, `contentType?` (keeps `content` for essays/code)
- [ ] Student submission UI per type:
  - ESSAY — text (current)
  - PROBLEM_SET / PRACTICAL — file upload (PDF, DOCX, scan images) + optional typed solution text
  - PROGRAMMING — monospace code textarea or code file upload
- [ ] Student uploads → existing Supabase storage bucket; teacher download via signed URL
- [ ] Keep one-submission-per-student constraint (existing unique index)

## Planned: W6 — Grading adapts to type

- [ ] `submission-text-extractor` service: PDF → text (`pdf-parse`), DOCX → text (`mammoth`), images → OCR attempt
- [ ] Insufficient extracted text → no AI grade, wait for teacher rubric review (`REVIEW_READY`)
- [ ] `grading.agent.ts` type-aware system prompts (programming correctness/edge cases; problem-set step tracing + partial credit; practical process/report review)

Note: current chat model (`openai.gpt-oss-20b-1:0`) is text-only — no vision/OCR-by-model today.

## Order

W1 (attachments) → W2 (chapters) → W3 (auto-enrollment) → W4 (types UI) → W5 (file submissions) → W6 (grading). Each phase builds and tests green independently.