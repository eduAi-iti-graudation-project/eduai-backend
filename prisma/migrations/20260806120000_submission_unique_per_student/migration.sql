-- One submission per (assignmentId, studentId).
-- First remove pre-existing duplicates, keeping the earliest submission per pair.
-- Related scores/chunks are removed by their ON DELETE CASCADE relations.
DELETE FROM "submissions" s
USING (
  SELECT "assignmentId",
         "studentId",
         MIN("id"::text)::uuid AS keep_id
  FROM "submissions"
  GROUP BY "assignmentId", "studentId"
  HAVING COUNT(*) > 1
) d
WHERE s."assignmentId" = d."assignmentId"
  AND s."studentId" = d."studentId"
  AND s."id" <> d.keep_id;

CREATE UNIQUE INDEX "submissions_assignmentId_studentId_key"
  ON "submissions"("assignmentId", "studentId");

ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_assignmentId_studentId_key"
  UNIQUE USING INDEX "submissions_assignmentId_studentId_key";
