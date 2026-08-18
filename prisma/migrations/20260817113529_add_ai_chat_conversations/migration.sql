-- CreateEnum
CREATE TYPE "AiChatKind" AS ENUM ('ASSISTANT', 'GUARDIAN');

-- AlterTable
ALTER TABLE "student_documents" ALTER COLUMN "category" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ai_chat_conversations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "AiChatKind" NOT NULL,
    "courseOfferingId" UUID,
    "studentId" UUID,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_chat_conversations_userId_updatedAt_idx" ON "ai_chat_conversations"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ai_chat_conversations_courseOfferingId_idx" ON "ai_chat_conversations"("courseOfferingId");

-- CreateIndex
CREATE INDEX "ai_chat_conversations_studentId_idx" ON "ai_chat_conversations"("studentId");

-- CreateIndex
CREATE INDEX "ai_chat_messages_conversationId_createdAt_idx" ON "ai_chat_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
