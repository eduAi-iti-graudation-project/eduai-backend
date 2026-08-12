-- CreateEnum
CREATE TYPE "LabStatus" AS ENUM ('GENERATING', 'AI_REVIEW_FAILED', 'PENDING_TEACHER_REVIEW', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "labs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "LabStatus" NOT NULL DEFAULT 'GENERATING',
    "generatedCode" TEXT,
    "reviewApproved" BOOLEAN,
    "reviewFlags" JSONB,
    "teacherNotes" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labs_organizationId_idx" ON "labs"("organizationId");

-- CreateIndex
CREATE INDEX "labs_courseOfferingId_idx" ON "labs"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "labs" ADD CONSTRAINT "labs_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
