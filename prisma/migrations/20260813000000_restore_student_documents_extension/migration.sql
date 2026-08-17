-- Restore the org-scoped + AI-suggested student documents extension that was
-- reverted by 20260808030204_add_study_generation. The document-intake flow
-- (bulk upload before student match, org scoping, AI-suggested student)
-- requires these columns, so the revert is undone here in forward form.
-- Contents mirror 20260807191018_extend_student_documents plus the
-- aiSuggestedStudentId FK that used to live in
-- 20260808100000_student_documents_ai_suggestion_fk (removed after merge).

-- CreateEnum
CREATE TYPE "StudentDocumentCategory" AS ENUM ('BIRTH_CERTIFICATE', 'IMMUNIZATION_RECORD', 'PREVIOUS_TRANSCRIPT', 'PAYMENT_RECEIPT', 'ID_DOCUMENT', 'OTHER');

-- AlterTable
ALTER TABLE "student_documents" ADD COLUMN     "aiMatchConfidence" DOUBLE PRECISION,
ADD COLUMN     "aiSuggestedCategory" TEXT,
ADD COLUMN     "aiSuggestedStudentId" UUID,
ADD COLUMN     "category" "StudentDocumentCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "organizationId" UUID;

-- Backfill organizationId from the owning student's organization (studentId is
-- still required on every existing row at this point).
UPDATE "student_documents" sd
SET "organizationId" = u."organizationId"
FROM "users" u
WHERE sd."studentId" = u.id;

ALTER TABLE "student_documents" ALTER COLUMN "organizationId" SET NOT NULL,
ALTER COLUMN "studentId" DROP NOT NULL;

-- Convert legacy type values to the new category bins. Anything without a
-- direct equivalent maps to OTHER; nothing is guessed into a specific bin.
UPDATE "student_documents" SET "category" = CASE "type"
  WHEN 'TRANSCRIPT' THEN 'PREVIOUS_TRANSCRIPT'::"StudentDocumentCategory"
  WHEN 'IMMUNIZATION' THEN 'IMMUNIZATION_RECORD'::"StudentDocumentCategory"
  WHEN 'ID' THEN 'ID_DOCUMENT'::"StudentDocumentCategory"
  ELSE 'OTHER'::"StudentDocumentCategory"
END;

ALTER TABLE "student_documents" ALTER COLUMN "category" DROP DEFAULT,
DROP COLUMN "type";

-- DropEnum
DROP TYPE "DocumentType";

-- CreateIndex
CREATE INDEX "student_documents_organizationId_idx" ON "student_documents"("organizationId");

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_aiSuggestedStudentId_fkey" FOREIGN KEY ("aiSuggestedStudentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;