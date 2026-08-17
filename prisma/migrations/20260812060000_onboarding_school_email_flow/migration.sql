-- CreateEnum
CREATE TYPE "JoinRequestKind" AS ENUM ('STUDENT', 'GUARDIAN');

-- AlterTable
ALTER TABLE "join_requests"
    ADD COLUMN "kind" "JoinRequestKind" NOT NULL DEFAULT 'STUDENT',
    ADD COLUMN "targetStudentEmail" TEXT,
    ADD COLUMN "chosenPasswordEncrypted" TEXT;

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "resetToken" TEXT,
    ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_resetToken_key" ON "users"("resetToken");