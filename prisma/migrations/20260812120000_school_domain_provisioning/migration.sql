-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "emailDomain" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credentialEncrypted" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifyToken" TEXT,
ADD COLUMN     "verifyTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_verifyToken_key" ON "users"("verifyToken");