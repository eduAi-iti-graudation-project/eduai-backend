-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "chapterId" UUID;

-- CreateTable
CREATE TABLE "material_chapters" (
    "id" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_chapters_courseOfferingId_order_idx" ON "material_chapters"("courseOfferingId", "order");

-- CreateIndex
CREATE INDEX "materials_chapterId_idx" ON "materials"("chapterId");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "material_chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_chapters" ADD CONSTRAINT "material_chapters_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
