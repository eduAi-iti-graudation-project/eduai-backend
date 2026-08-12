-- CreateEnum
CREATE TYPE "JoinRequestSource" AS ENUM ('ROSTER', 'SELF');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "assignmentId" UUID;

-- AlterTable
ALTER TABLE "membership_requests" ADD COLUMN     "city" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelationship" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "ssnEncrypted" TEXT,
ADD COLUMN     "ssnTail4" TEXT,
ADD COLUMN     "street" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT;

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "ssnEncrypted" TEXT,
    "ssnTail4" TEXT,
    "phone" TEXT,
    "street" TEXT,
    "city" TEXT,
    "nationality" TEXT,
    "personalEmail" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_profiles" (
    "id" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "ssnEncrypted" TEXT,
    "ssnTail4" TEXT,
    "phone" TEXT,
    "street" TEXT,
    "city" TEXT,
    "nationality" TEXT,
    "personalEmail" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "profileComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardian_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "join_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "source" "JoinRequestSource" NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authId" TEXT,
    "gradeId" UUID,
    "gradeLevelName" TEXT,
    "sectionId" UUID,
    "sectionName" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guardianName" TEXT,
    "guardianEmail" TEXT,
    "guardianSsnEncrypted" TEXT,
    "guardianSsnTail4" TEXT,
    "guardianPhone" TEXT,
    "guardianNationality" TEXT,
    "guardianStreet" TEXT,
    "guardianCity" TEXT,
    "guardianDateOfBirth" TIMESTAMP(3),

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_teacherId_key" ON "teacher_profiles"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_profiles_guardianId_key" ON "guardian_profiles"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "join_requests_authId_key" ON "join_requests"("authId");

-- CreateIndex
CREATE INDEX "join_requests_organizationId_status_idx" ON "join_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "join_requests_organizationId_email_idx" ON "join_requests"("organizationId", "email");

-- CreateIndex
CREATE INDEX "materials_assignmentId_idx" ON "materials"("assignmentId");

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_profiles" ADD CONSTRAINT "guardian_profiles_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grade_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
