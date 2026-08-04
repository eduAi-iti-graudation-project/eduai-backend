-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "trialReminderSentAt" TIMESTAMP(3),
ADD COLUMN "trialExpiredSentAt" TIMESTAMP(3);
