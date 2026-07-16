-- AlterTable: Rubric - add isConfirmed
ALTER TABLE "rubrics" ADD COLUMN "isConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: RubricCriteria - add embedding column (pgvector)
ALTER TABLE "rubric_criteria" ADD COLUMN "embedding" vector(1536);

-- AlterTable: GradingScore - add isConfirmed
ALTER TABLE "grading_scores" ADD COLUMN "isConfirmed" BOOLEAN NOT NULL DEFAULT false;
