-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" UUID NOT NULL,
    "courseOfferingId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "room" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timetable_slots_courseOfferingId_idx" ON "timetable_slots"("courseOfferingId");

-- CreateIndex
CREATE INDEX "timetable_slots_organizationId_dayOfWeek_idx" ON "timetable_slots"("organizationId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "timetable_slots_courseOfferingId_dayOfWeek_idx" ON "timetable_slots"("courseOfferingId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
