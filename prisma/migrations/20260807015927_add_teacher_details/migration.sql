-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "TeacherDocumentType" AS ENUM ('SOCIAL_SECURITY', 'NATIONAL_ID', 'PASSPORT', 'LICENSE', 'DEGREE', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "SalaryStatus" AS ENUM ('PAID', 'PARTIAL', 'POSTPONED', 'UNPAID');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gender" "Gender";

-- CreateTable
CREATE TABLE "class_teacher_logs" (
    "id" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_teacher_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_documents" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "type" "TeacherDocumentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_records" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2),
    "status" "SalaryStatus" NOT NULL DEFAULT 'UNPAID',
    "body" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_teacher_logs_teacherId_idx" ON "class_teacher_logs"("teacherId");

-- CreateIndex
CREATE INDEX "class_teacher_logs_classId_idx" ON "class_teacher_logs"("classId");

-- CreateIndex
CREATE INDEX "teacher_documents_teacherId_idx" ON "teacher_documents"("teacherId");

-- CreateIndex
CREATE INDEX "salary_records_teacherId_period_idx" ON "salary_records"("teacherId", "period");

-- AddForeignKey
ALTER TABLE "class_teacher_logs" ADD CONSTRAINT "class_teacher_logs_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teacher_logs" ADD CONSTRAINT "class_teacher_logs_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
