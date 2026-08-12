/*
  Warnings:

  - You are about to drop the `study_generations` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "study_generations" DROP CONSTRAINT "study_generations_courseOfferingId_fkey";

-- DropForeignKey
ALTER TABLE "study_generations" DROP CONSTRAINT "study_generations_studentId_fkey";

-- DropTable
DROP TABLE "study_generations";

-- CreateTable
CREATE TABLE "StudyGeneration" (
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
    "recommendedForAnalysisId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyGeneration_studentId_createdAt_idx" ON "StudyGeneration"("studentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StudyGeneration_recommendedForAnalysisId_idx" ON "StudyGeneration"("recommendedForAnalysisId");

-- AddForeignKey
ALTER TABLE "StudyGeneration" ADD CONSTRAINT "StudyGeneration_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGeneration" ADD CONSTRAINT "StudyGeneration_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGeneration" ADD CONSTRAINT "StudyGeneration_recommendedForAnalysisId_fkey" FOREIGN KEY ("recommendedForAnalysisId") REFERENCES "student_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
