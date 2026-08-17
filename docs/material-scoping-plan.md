# Section-scoped materials + AI-feature dropdowns — implementation plan

Status: approved. Ready to implement.

## Core rules (decisions locked)

1. **A material's visibility = the sections it was scoped to** (single row, no fan-out duplication).
2. **Upload permission is section-scoped**: a teacher may only target sections they teach
   (`courseOfferings WHERE teacherId = me`); ADMIN may target any section in the org.
3. **Course tab upload auto-covers all of the teacher's sections for that course** — one upload
   reaches the whole grade when the teacher teaches every section of it.
4. **Teacher course-tab shows only their own sections' materials** — teacher x (teaches A) never
   sees teacher y's (teaches B) content.
5. **Students pick a course, never a section/grade** — their section is implied by their
   enrollment.
6. **Teachers pick grade → course → section** in AI features; where multiple sections exist for a
   course, default to the first teaching offering with the cascade available for switching.

---

## Part A — Section-scoped materials

### A1. Prisma migration (`prisma/schema.prisma`)

- `Material.courseOfferingId` → `String?` (nullable; legacy single-section rows).
- Add `Material.createdById String?` (uploader, for teacher-scoped reads) + relation to `User`.
- New join table `MaterialSectionScope`:

```prisma
model MaterialSectionScope {
  materialId       String         @db.Uuid
  courseOfferingId String         @db.Uuid
  material         Material       @relation(fields: [materialId], references: [id], onDelete: Cascade)
  offering         CourseOffering @relation(fields: [courseOfferingId], references: [id], onDelete: Cascade)
  @@id([materialId, courseOfferingId])
  @@map("material_section_scopes")
}
```

- Migration SQL backfills: for every existing material row, create a `material_section_scopes`
  row from its `courseOfferingId`, and set `createdById` from the offering's `teacherId`.
- `npx prisma migrate dev`, then `npx prisma db seed` stays valid.

### A2. Upload + permission (`src/materials/materials.service.ts`)

`upload()` accepts one of:

- `{ courseOfferingId }` — legacy single-section path.
- `{ courseId }` — course-level path (auto-scope to the teacher's sections).

Shared params: `title`, file, `chapterId?`, `assignmentId?`.

- **Legacy path:** verify offering is in org **and `teacherId === currentUser.id`** (ADMIN
  bypass). This closes the current gap where any authenticated org user can upload to any
  section (today the check is org-only, materials.service.ts:47).
- **Course path:** resolve scope = `courseOfferings WHERE courseId = X AND teacherId = me`
  (ADMIN: all org offerings of the course). If the teacher teaches none → `FORBIDDEN`. Reject
  `assignmentId` on the course path (assignments are per-section).
- Store **one row**: `courseId` set, `courseOfferingId` null, `createdById` set,
  `scopes` = resolved offerings.
- Chapter detection/creation on the course path → course-level chapters (`courseId` set,
  `courseOfferingId` null). Storage path becomes `materials/${courseId}/${material.id}.pdf`.
- **Access rework** — `findMaterialWithAccess` / `assertCanAccess`: build the material's scope
  offerings (from `courseOfferingId` or `scopes`), then:
  - ADMIN → allowed
  - TEACHER → teaches any scoped offering
  - STUDENT → approved-enrolled in a scoped section
  - GUARDIAN → ward enrolled in a scoped section
- `findOne`, `delete`, `moveMaterialToChapter`: broaden org-scope from
  `{ offering: { organizationId } }` to `OR: [{ offering: { organizationId } }, { course: { organizationId } }]`.

### A3. Reads (merge scoped materials)

- `findByOffering` / `findByOfferingGrouped` / `searchChunks(offeringId)`: include rows where
  `scope ∋ offeringId` OR legacy `courseOfferingId = offeringId`; grouped view also returns
  course-level chapters with per-section material filtering.
- `findByCourse` / `findByCourseGrouped`: accept the current user; a teacher sees only materials
  scoped to their own offerings (never another teacher's sections).
- `searchChunksByCourse`: replace the `JOIN course_offerings co ON co.id = m."courseOfferingId"`
  (which drops null-offering rows, materials.service.ts:563) with a filter on `m."courseId" = ${courseId}`.

### A4. Controller + DTO

- `UploadMaterialSchema`: `courseOfferingId` optional, `courseId` optional, refine → **exactly
  one** required. Update the Swagger `@ApiBody`.
- `POST /materials/upload`: add `@Roles('TEACHER','ADMIN')`; pass the full `@CurrentUser()`
  user to the service (currently only `organizationId` is passed).

### A5. Frontend

- `src/lib/api.ts` `uploadMaterial()`: add a `courseId` param (posts `courseId` instead of
  `courseOfferingId`).
- `src/pages/teacher/CourseMaterialsTab.tsx`: upload with `courseId` (drop `offeringId`); the
  CoursePage badges already show which sections it covers.
- `src/pages/teacher/ClassMaterialsTab.tsx`: unchanged (per-section uploads).
- Student pages: unchanged — the backend merge handles visibility.

### A6. Tests (backend)

`src/materials/materials.service.spec.ts` + `src/materials/materials.controller.spec.ts`:

- upload-by-course: teacher with 2 offerings → scope `[A,B]`; with 1 → `[A]`; with 0 →
  forbidden; admin → all org offerings; `assignmentId` on the course path rejected.
- permission: teacher can't upload to a section they don't teach; legacy path enforced.
- reads: student in B sees only B-scoped; course tab isolates teachers;
  `searchChunks`/`searchChunksByCourse` include scoped + null-offering rows.
- access: scoped student/guardian ok; non-enrolled 403; teacher of any scoped offering ok;
  `findOne`/`delete`/`moveMaterialToChapter` on course-scoped rows.
- controller: `courseId` passthrough; exactly-one DTO validation.

---

## Part B — AI-feature dropdowns

### B1. Audit summary

| Feature | Side | Current dropdown | Verdict |
|---|---|---|---|
| AI Assistant (Course tab) | Teacher | Grade → Course → Section cascade, filtered to your offerings | ✅ No change |
| AI Assistant (Students tab) | Teacher | Student-search copilot, no course scope | ✅ No change |
| Homework Help | Student | Course only + optional assignment (offering id hidden behind course name) | ✅ No change |
| Study Lab | Student | `course · section · N materials` — forces student to pick their section | ❌ Fix |
| Lab Simulations | Teacher | One flat `course · section` list across all grades | ❌ Fix |
| Student Labs list | Student | Display-only `course · section` label | Minor cleanup |

All AI features ground via `materials.searchChunks(courseOfferingId)`; once materials become
section-scoped they pick up course-wide content automatically — no extra wiring.

### B2. Study Lab — student picks course only

- **Backend** `StudyLabService.getStudentOfferings` (study-lab.service.ts:534): return **one
  entry per course** — `{ offeringId, courseId, courseName, materialCount }`, drop `sectionName`.
  Safe: each student is in exactly one section per grade (sections.service.ts:185-194), so one
  offering per course.
- **Frontend** `StudyLabPage`: dropdown shows `courseName` (+ material count); still sends
  `courseOfferingId` to `generate`.
- Update `StudyLabOffering` type in `src/lib/api.ts`.

### B3. Teacher Lab Simulations — Grade → Course → Section cascade

- **Frontend** `LabsPage`: add Grade dropdown first (from `getTeacherGrades`), then Course,
  then Section — mirroring the assistant's cascade (AssistantPage.tsx:169-247). The selected
  **section offering** drives `generate` and the lab list filter as today.
- **Default:** pre-select the teacher's first teaching offering (recommended, approved) with the
  cascade available for switching.
- `getTeacherOfferings(teacherId)` already returns `section.gradeLevelId`; grades come from
  `getTeacherGrades`.

### B4. Student Labs list label

- Drop the `· sectionName` from the card label (course is unambiguous for the student).

### B5. Tests (Part B)

- Study-lab service spec: `getStudentOfferings` returns one row per course (deduped), no
  section leak.
- Frontend vitest: StudyLabPage renders course-only options; LabsPage renders the
  grade→course→section cascade (not the flat list) with the first offering pre-selected.
- Existing backend/frontend suites stay green.

---

## Verification (both parts)

- Backend: `npm run lint && npm run test && npm run build`
- Frontend: `npm run lint && npm run test && npm run build`

## Follow-ups (noted, not in this change)

- `listMaterialTitles` / assignment-attach UI stays offering-scoped; course-scoped materials are
  not attachable to assignments by design.
- Chapters already support course-level structure; offering-scoped legacy chapters remain
  readable.

---

## Follow-up plan: org-wide course scope (NOT yet implemented)

**Status:** deferred. Implement only if multiple teachers teach different sections of the same
course and they want one shared course-material bucket.

### Problem

Today a course-level upload (`{ courseId }`) auto-scopes to **only the sections the uploading
teacher teaches**
(`upload()` → `courseOfferings WHERE courseId = X AND teacherId = me`,
`src/materials/materials.service.ts:113-119`). If teacher A teaches Section A of Science and
teacher B teaches Section B, A's course upload is invisible to B's students (and vice versa),
which breaks the mental model of "one Science course bucket per grade."

### Proposed behavior

- Add an upload-time scope choice for course-level uploads:
  - **"My sections"** (today's behavior) — default.
  - **"All sections of this course" (org-wide)** — scope = `courseOfferings WHERE courseId = X`
    regardless of `teacherId`.
- Read side (`findByOffering` / `findByCourseGrouped`) needs no change: a material's visibility is
  still its scope rows; students/teachers already see anything scoped to their section.

### Open decisions

1. **Permission:** may any teacher of the course upload org-wide, or only ADMIN? Options:
   - Any teacher who teaches the course in ≥1 section can publish org-wide (trusted-peer model).
   - Only ADMIN can scope beyond their own sections.
2. **Audit/safety:** once org-wide, a teacher can affect sections they don't teach. Consider a
   `scopeMode` column (`MY_SECTIONS` | `ORG_WIDE`) on `Material` for future filtering/rollback,
   and mention org-wide coverage in the course page badges.
3. **Existing rows:** course-scoped rows uploaded today stay teacher-scoped; no backfill unless a
   re-scope UI is added.

### Implementation sketch (when approved)

- `UploadMaterialSchema`/`upload()` opts: add `scope: 'mySections' | 'allSections'` (default
  `mySections`); org-wide resolves offerings without the `teacherId` filter.
- Frontend `ClassMaterialsTab` "All sections of this course" toggle sends `scope: 'allSections'`;
  `CourseMaterialsTab` may gain the same toggle.
- Tests: org-wide upload scopes to all org offerings of the course; permission rule from
  decision 1; teacher who doesn't teach the course still forbidden.