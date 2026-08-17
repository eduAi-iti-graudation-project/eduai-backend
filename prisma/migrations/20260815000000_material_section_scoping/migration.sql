-- Section-scoped materials: a material's visibility = the sections it was
-- scoped to. Legacy single-section rows keep courseOfferingId; course-level
-- uploads carry a nullable courseOfferingId and live in material_section_scopes.

-- AlterTable
ALTER TABLE "materials" ALTER COLUMN "courseOfferingId" DROP NOT NULL,
ADD COLUMN     "createdById" UUID;

-- CreateTable
CREATE TABLE "material_section_scopes" (
    "materialId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,

    CONSTRAINT "material_section_scopes_pkey" PRIMARY KEY ("materialId","courseOfferingId")
);

-- Backfill: every existing material row becomes scoped to its single offering,
-- and the uploader is set from the offering's teacher.
INSERT INTO "material_section_scopes" ("materialId", "courseOfferingId")
SELECT "id", "courseOfferingId" FROM "materials" WHERE "courseOfferingId" IS NOT NULL;

UPDATE "materials" m
SET "createdById" = co."teacherId"
FROM "course_offerings" co
WHERE co.id = m."courseOfferingId" AND m."createdById" IS NULL;

-- CreateIndex
CREATE INDEX "materials_createdById_idx" ON "materials"("createdById");
CREATE INDEX "material_section_scopes_courseOfferingId_idx" ON "material_section_scopes"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_section_scopes" ADD CONSTRAINT "material_section_scopes_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_section_scopes" ADD CONSTRAINT "material_section_scopes_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;