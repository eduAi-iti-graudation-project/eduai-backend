CREATE INDEX ON "rubric_criteria" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON "submission_chunks" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON "material_chunks" USING hnsw (embedding vector_cosine_ops);