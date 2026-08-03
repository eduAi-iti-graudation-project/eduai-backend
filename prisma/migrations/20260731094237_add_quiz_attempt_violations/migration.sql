-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "violations" JSONB NOT NULL DEFAULT '[]';
