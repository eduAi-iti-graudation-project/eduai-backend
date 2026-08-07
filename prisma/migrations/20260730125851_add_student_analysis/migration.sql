-- CreateTable
CREATE TABLE "student_analyses" (
    "id" UUID NOT NULL,
    "submissionId" UUID,
    "studentId" UUID NOT NULL,
    "alertId" UUID,
    "classId" UUID,
    "diagnosis" JSONB NOT NULL,
    "teacherContent" JSONB,
    "guardianContent" JSONB,
    "teacherFeedback" JSONB,
    "managementSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_analyses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "student_analyses" ADD CONSTRAINT "student_analyses_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_analyses" ADD CONSTRAINT "student_analyses_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
