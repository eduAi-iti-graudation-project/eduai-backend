-- Add a join code so schools can join an existing SchoolGroup by code.
-- Existing groups are backfilled with a generated code before the column
-- is made NOT NULL.
ALTER TABLE "school_groups" ADD COLUMN "joinCode" TEXT;

UPDATE "school_groups"
SET "joinCode" = UPPER(SUBSTRING(MD5("id"::TEXT || ':' || GEN_RANDOM_UUID()::TEXT), 1, 8))
WHERE "joinCode" IS NULL;

ALTER TABLE "school_groups" ALTER COLUMN "joinCode" SET NOT NULL;

CREATE UNIQUE INDEX "school_groups_joinCode_key" ON "school_groups"("joinCode");