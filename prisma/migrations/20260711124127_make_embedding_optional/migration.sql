-- AlterTable
ALTER TABLE "material_chunks" ALTER COLUMN "embedding" DROP NOT NULL;

-- AlterTable
ALTER TABLE "submission_chunks" ALTER COLUMN "embedding" DROP NOT NULL;
