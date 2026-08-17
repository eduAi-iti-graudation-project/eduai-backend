-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "pendingParticipantTranscripts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "struggleSignalsProcessed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "studentId" UUID;

-- CreateTable
CREATE TABLE "meeting_transcript_segments" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "meeting_transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "struggle_signals" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "concept" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "classWide" BOOLEAN NOT NULL DEFAULT false,
    "quizId" UUID,
    "interactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "struggle_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_transcript_segments_meetingId_idx" ON "meeting_transcript_segments"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_transcript_segments_userId_meetingId_idx" ON "meeting_transcript_segments"("userId", "meetingId");

-- CreateIndex
CREATE INDEX "struggle_signals_meetingId_status_idx" ON "struggle_signals"("meetingId", "status");

-- CreateIndex
CREATE INDEX "struggle_signals_studentId_idx" ON "struggle_signals"("studentId");

-- CreateIndex
CREATE INDEX "quizzes_studentId_idx" ON "quizzes"("studentId");

-- AddForeignKey
ALTER TABLE "meeting_transcript_segments" ADD CONSTRAINT "meeting_transcript_segments_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_transcript_segments" ADD CONSTRAINT "meeting_transcript_segments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "struggle_signals" ADD CONSTRAINT "struggle_signals_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "struggle_signals" ADD CONSTRAINT "struggle_signals_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

