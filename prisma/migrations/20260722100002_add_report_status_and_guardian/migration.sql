-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('NEW', 'SENT', 'VIEWED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "guardianId" UUID;

-- AlterTable
ALTER TABLE "student_reports" ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'NEW';

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
