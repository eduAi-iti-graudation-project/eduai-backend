ALTER TABLE rubric_criteria ALTER COLUMN embedding TYPE vector(2048);
ALTER TABLE submission_chunks ALTER COLUMN embedding TYPE vector(2048);
ALTER TABLE material_chunks ALTER COLUMN embedding TYPE vector(2048);