-- Add new values to SubmissionStatus enum
ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'REVIEW_READY';
ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
