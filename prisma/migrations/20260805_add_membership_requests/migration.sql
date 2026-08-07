-- CreateTable
CREATE TABLE "membership_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "authId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "membership_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (stepwise: nullable first, backfill, then NOT NULL)
ALTER TABLE "organizations" ADD COLUMN "joinCode" TEXT;

-- Backfill existing organizations with a unique random 8-char code
DO $$
DECLARE
    org_record RECORD;
    code TEXT;
BEGIN
    FOR org_record IN SELECT id FROM organizations LOOP
        LOOP
            code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
            EXIT WHEN NOT EXISTS (SELECT 1 FROM organizations WHERE "joinCode" = code);
        END LOOP;
        UPDATE organizations SET "joinCode" = code WHERE id = org_record.id;
    END LOOP;
END $$;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "joinCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_joinCode_key" ON "organizations"("joinCode");
