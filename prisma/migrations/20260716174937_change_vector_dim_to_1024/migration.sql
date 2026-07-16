ALTER TABLE material_chunks ALTER COLUMN embedding SET DATA TYPE vector(1024) USING embedding::vector(1024);
ALTER TABLE rubric_criteria ALTER COLUMN embedding SET DATA TYPE vector(1024) USING embedding::vector(1024);
ALTER TABLE submission_chunks ALTER COLUMN embedding SET DATA TYPE vector(1024) USING embedding::vector(1024);
