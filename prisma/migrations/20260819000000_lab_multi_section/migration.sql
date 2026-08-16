-- CreateTable
CREATE TABLE "lab_offerings" (
    "labId" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,

    CONSTRAINT "lab_offerings_pkey" PRIMARY KEY ("labId","courseOfferingId")
);

-- CreateIndex
CREATE INDEX "lab_offerings_courseOfferingId_idx" ON "lab_offerings"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "lab_offerings" ADD CONSTRAINT "lab_offerings_labId_fkey" FOREIGN KEY ("labId") REFERENCES "labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_offerings" ADD CONSTRAINT "lab_offerings_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
