-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'GUARDIAN';
ALTER TYPE "UserRole" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "authId" TEXT;
CREATE UNIQUE INDEX "users_authId_key" ON "users"("authId");
