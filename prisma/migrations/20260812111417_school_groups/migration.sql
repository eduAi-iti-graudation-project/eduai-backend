-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "groupId" UUID;

-- CreateTable
CREATE TABLE "school_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'TRIAL',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "seatLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_groups_stripeCustomerId_key" ON "school_groups"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "school_groups_stripeSubscriptionId_key" ON "school_groups"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "organizations_groupId_idx" ON "organizations"("groupId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "school_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
