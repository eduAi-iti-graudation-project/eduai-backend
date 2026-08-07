-- DropForeignKey
ALTER TABLE "class_teacher_logs" DROP CONSTRAINT "class_teacher_logs_classId_fkey";

-- DropForeignKey
ALTER TABLE "classes" DROP CONSTRAINT "classes_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "classes" DROP CONSTRAINT "classes_teacherId_fkey";

-- DropForeignKey
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_classId_fkey";

-- DropForeignKey
ALTER TABLE "grade_classes" DROP CONSTRAINT "grade_classes_classId_fkey";

-- DropForeignKey
ALTER TABLE "grade_classes" DROP CONSTRAINT "grade_classes_gradeId_fkey";

-- DropForeignKey
ALTER TABLE "materials" DROP CONSTRAINT "materials_classId_fkey";

-- DropForeignKey
ALTER TABLE "quizzes" DROP CONSTRAINT "quizzes_classId_fkey";

-- DropForeignKey
ALTER TABLE "teacher_grades" DROP CONSTRAINT "teacher_grades_gradeId_fkey";

-- DropForeignKey
ALTER TABLE "teacher_grades" DROP CONSTRAINT "teacher_grades_teacherId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_gradeId_fkey";

-- DropIndex
DROP INDEX "attendance_studentId_classId_date_key";

-- DropIndex
DROP INDEX "chat_threads_teacherId_studentId_classId_key";

-- DropIndex
DROP INDEX "class_teacher_logs_classId_idx";

-- DropIndex
DROP INDEX "enrollments_classId_studentId_key";

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "courseOfferingId" UUID;

-- AlterTable
ALTER TABLE "assignments" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "attendance" DROP COLUMN "classId",
ADD COLUMN     "sectionId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "chat_threads" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "class_teacher_logs" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "classId",
ADD COLUMN     "sectionId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "homework_help_interactions" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "materials" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "quizzes" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "student_analyses" DROP COLUMN "classId",
ADD COLUMN     "courseOfferingId" UUID;

-- DropTable
DROP TABLE "classes";

-- DropTable
DROP TABLE "grade_classes";

-- DropTable
DROP TABLE "grades";

-- DropTable
DROP TABLE "teacher_grades";

-- CreateTable
CREATE TABLE "grade_levels" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "gradeLevelId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "gradeLevelId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_offerings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_levels_organizationId_idx" ON "grade_levels"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "grade_levels_organizationId_level_key" ON "grade_levels"("organizationId", "level");

-- CreateIndex
CREATE INDEX "sections_organizationId_idx" ON "sections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sections_organizationId_gradeLevelId_name_key" ON "sections"("organizationId", "gradeLevelId", "name");

-- CreateIndex
CREATE INDEX "courses_organizationId_idx" ON "courses"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organizationId_gradeLevelId_name_key" ON "courses"("organizationId", "gradeLevelId", "name");

-- CreateIndex
CREATE INDEX "course_offerings_organizationId_idx" ON "course_offerings"("organizationId");

-- CreateIndex
CREATE INDEX "course_offerings_teacherId_idx" ON "course_offerings"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "course_offerings_courseId_sectionId_key" ON "course_offerings"("courseId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_studentId_sectionId_date_key" ON "attendance"("studentId", "sectionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "chat_threads_teacherId_studentId_courseOfferingId_key" ON "chat_threads"("teacherId", "studentId", "courseOfferingId");

-- CreateIndex
CREATE INDEX "class_teacher_logs_courseOfferingId_idx" ON "class_teacher_logs"("courseOfferingId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_sectionId_studentId_key" ON "enrollments"("sectionId", "studentId");

-- AddForeignKey
ALTER TABLE "grade_levels" ADD CONSTRAINT "grade_levels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "grade_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "grade_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grade_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_analyses" ADD CONSTRAINT "student_analyses_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_help_interactions" ADD CONSTRAINT "homework_help_interactions_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teacher_logs" ADD CONSTRAINT "class_teacher_logs_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

