-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TeacherAttendanceSource" AS ENUM ('SELF', 'ADMIN');

-- CreateEnum
CREATE TYPE "FineType" AS ENUM ('ATTENDANCE', 'LATE', 'OTHER');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('PAID', 'PARTIAL', 'POSTPONED', 'UNPAID');

-- DropIndex
DROP INDEX "attendance_studentId_sectionId_date_key";

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "courseOfferingId" UUID;

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_attendance" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "source" "TeacherAttendanceSource" NOT NULL DEFAULT 'SELF',
    "sessionId" UUID,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_fines" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "type" "FineType" NOT NULL DEFAULT 'ATTENDANCE',
    "status" "FineStatus" NOT NULL DEFAULT 'UNPAID',
    "amountPaid" DECIMAL(10,2),
    "dueDate" TIMESTAMP(3),
    "issuedById" UUID NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_fines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_tokenHash_key" ON "attendance_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "attendance_sessions_organizationId_idx" ON "attendance_sessions"("organizationId");

-- CreateIndex
CREATE INDEX "attendance_sessions_courseOfferingId_idx" ON "attendance_sessions"("courseOfferingId");

-- CreateIndex
CREATE INDEX "teacher_attendance_courseOfferingId_idx" ON "teacher_attendance"("courseOfferingId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendance_teacherId_courseOfferingId_date_key" ON "teacher_attendance"("teacherId", "courseOfferingId", "date");

-- CreateIndex
CREATE INDEX "teacher_fines_teacherId_idx" ON "teacher_fines"("teacherId");

-- CreateIndex
CREATE INDEX "teacher_fines_organizationId_idx" ON "teacher_fines"("organizationId");

-- CreateIndex
CREATE INDEX "attendance_studentId_sectionId_date_idx" ON "attendance"("studentId", "sectionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_studentId_courseOfferingId_date_key" ON "attendance"("studentId", "courseOfferingId", "date");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_fines" ADD CONSTRAINT "teacher_fines_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_fines" ADD CONSTRAINT "teacher_fines_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_fines" ADD CONSTRAINT "teacher_fines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

