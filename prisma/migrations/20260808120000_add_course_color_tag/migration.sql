-- AlterTable
ALTER TABLE "courses" ADD COLUMN "colorTag" TEXT;

-- Backfill: assign the 8-color palette in creation order so every existing
-- course has a stable color. Palette: blue, teal, pink, orange, cyan,
-- fuchsia, lime, brown. Row index is scoped per organization so each org's
-- courses start from the beginning of the palette.
WITH numbered AS (
  SELECT
    id,
    (row_number() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) - 1) AS idx
  FROM "courses"
)
UPDATE "courses" c
SET "colorTag" = (
  ARRAY['#3B82F6','#0D9488','#EC4899','#EA580C','#0891B2','#C026D3','#65A30D','#92400E']
)[(numbered.idx % 8) + 1]
FROM numbered
WHERE c.id = numbered.id;

-- AlterTable
ALTER TABLE "courses" ALTER COLUMN "colorTag" SET NOT NULL;
