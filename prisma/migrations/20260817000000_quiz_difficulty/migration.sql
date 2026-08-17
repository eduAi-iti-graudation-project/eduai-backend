-- Quiz difficulty: teachers pick EASY/MEDIUM/HARD when generating a quiz so
-- the AI calibrates question depth. Existing quizzes become MEDIUM (the
-- default the generation agent already used).

-- CreateEnum
CREATE TYPE "QuizDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- AlterTable: quiz gains a difficulty level, defaulting to MEDIUM.
ALTER TABLE "quizzes" ADD COLUMN     "difficulty" "QuizDifficulty" NOT NULL DEFAULT 'MEDIUM';