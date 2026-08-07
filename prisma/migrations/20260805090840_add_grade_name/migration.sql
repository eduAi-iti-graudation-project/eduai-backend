-- AlterTable
ALTER TABLE "grades" ADD COLUMN     "name" TEXT;

-- Backfill names for existing grades
UPDATE "grades" SET "name" = 'Grade ' || "level" WHERE "name" IS NULL;
