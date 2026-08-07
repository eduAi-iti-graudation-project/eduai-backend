-- Add foreign key for the AI-suggested student relation on student_documents.
-- Deleting a suggested student only drops the suggestion (SET NULL), never the document.
ALTER TABLE "student_documents"
  ADD CONSTRAINT "student_documents_aiSuggestedStudentId_fkey"
  FOREIGN KEY ("aiSuggestedStudentId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
