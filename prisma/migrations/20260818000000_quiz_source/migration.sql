-- Quiz source: distinguishes AI-generated quizzes (assignments locked in the
-- editor) from hand-created ones.

-- CreateEnum
CREATE TYPE "QuizSource" AS ENUM ('MANUAL', 'AI');

-- AlterTable: quiz gains a source, defaulting to MANUAL.
ALTER TABLE "quizzes" ADD COLUMN     "source" "QuizSource" NOT NULL DEFAULT 'MANUAL';
