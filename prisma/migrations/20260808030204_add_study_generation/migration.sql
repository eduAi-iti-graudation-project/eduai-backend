/*
  Warnings:

  - You are about to drop the column `aiMatchConfidence` on the `student_documents` table. All the data in the column will be lost.
  - You are about to drop the column `aiSuggestedCategory` on the `student_documents` table. All the data in the column will be lost.
  - You are about to drop the column `aiSuggestedStudentId` on the `student_documents` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `student_documents` table. All the data in the column will be lost.
  - You are about to drop the column `organizationId` on the `student_documents` table. All the data in the column will be lost.
  - Made the column `studentId` on table `student_documents` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CERTIFICATE', 'REPORT_CARD', 'TRANSCRIPT', 'IMMUNIZATION', 'TRANSFER', 'ENROLLMENT_FORM', 'ID', 'MEDICAL', 'OTHER');

-- DropForeignKey
ALTER TABLE "student_documents" DROP CONSTRAINT IF EXISTS "student_documents_aiSuggestedStudentId_fkey";

-- DropForeignKey
ALTER TABLE "student_documents" DROP CONSTRAINT "student_documents_organizationId_fkey";

-- DropIndex
DROP INDEX "student_documents_organizationId_idx";

-- AlterTable
ALTER TABLE "student_documents" DROP COLUMN "aiMatchConfidence",
DROP COLUMN "aiSuggestedCategory",
DROP COLUMN "aiSuggestedStudentId",
DROP COLUMN "category",
DROP COLUMN "organizationId",
ADD COLUMN     "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
ALTER COLUMN "studentId" SET NOT NULL;

-- DropEnum
DROP TYPE "StudentDocumentCategory";

-- CreateTable
CREATE TABLE "study_generations" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "materialKind" TEXT,
    "preset" TEXT,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "stage" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB,
    "audioUrl" TEXT,
    "fileUrl" TEXT,
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_generations_studentId_createdAt_idx" ON "study_generations"("studentId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "study_generations" ADD CONSTRAINT "study_generations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_generations" ADD CONSTRAINT "study_generations_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
