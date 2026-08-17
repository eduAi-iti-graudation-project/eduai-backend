-- AlterTable
ALTER TABLE "material_chapters" ADD COLUMN     "courseId" UUID,
ALTER COLUMN "courseOfferingId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "courseId" UUID;

-- Backfill courseId from the owning course offering
UPDATE "materials" m
SET "courseId" = co."courseId"
FROM "course_offerings" co
WHERE co.id = m."courseOfferingId";

UPDATE "material_chapters" mc
SET "courseId" = co."courseId"
FROM "course_offerings" co
WHERE co.id = mc."courseOfferingId";

-- CreateIndex
CREATE INDEX "material_chapters_courseId_order_idx" ON "material_chapters"("courseId", "order");

-- CreateIndex
CREATE INDEX "materials_courseId_idx" ON "materials"("courseId");
