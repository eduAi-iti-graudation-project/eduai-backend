-- Flexible quiz targeting: a quiz is no longer tied to a single course
-- offering (or a single student). Visibility is now expressed through the
-- quiz_assignments join table — one row per (quiz, offering), each with an
-- optional targeted-student list (empty = every approved-enrolled student in
-- the offering's section). Legacy columns courseOfferingId/studentId are
-- backfilled into assignments and then dropped. endsAt makes the existing
-- "Closes at" UI field functional.

-- AlterTable: quiz gains a nullable endsAt deadline.
ALTER TABLE "quizzes" ADD COLUMN     "endsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "quiz_assignments" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "targetStudentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_assignments_pkey" PRIMARY KEY ("id")
);

-- Backfill: every existing quiz becomes assigned to its legacy offering.
-- Legacy student-scoped quizzes (struggle-signal dispatch) keep that student
-- as a targeted student; class-wide quizzes target nobody.
INSERT INTO "quiz_assignments" ("id", "quizId", "courseOfferingId", "targetStudentIds")
SELECT gen_random_uuid(), "id", "courseOfferingId",
       CASE WHEN "studentId" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["studentId"]::TEXT[] END
FROM "quizzes"
WHERE "courseOfferingId" IS NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "quizzes_studentId_idx";

-- AlterTable: legacy single-offering / single-student columns are superseded
-- by quiz_assignments.
ALTER TABLE "quizzes" DROP COLUMN "courseOfferingId",
DROP COLUMN "studentId";

-- CreateIndex
CREATE UNIQUE INDEX "quiz_assignments_quizId_courseOfferingId_key" ON "quiz_assignments"("quizId", "courseOfferingId");
CREATE INDEX "quiz_assignments_courseOfferingId_idx" ON "quiz_assignments"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "quiz_assignments" ADD CONSTRAINT "quiz_assignments_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_assignments" ADD CONSTRAINT "quiz_assignments_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;