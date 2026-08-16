
-- CreateEnum
CREATE TYPE "AdminChatPeerRole" AS ENUM ('TEACHER', 'GUARDIAN');

-- CreateTable
CREATE TABLE "admin_chat_threads" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "peerId" UUID NOT NULL,
    "peerRole" "AdminChatPeerRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_chat_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "targetRoles" "UserRole"[],
    "targetGradeId" UUID,
    "createdById" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_chat_threads_adminId_peerId_peerRole_key" ON "admin_chat_threads"("adminId", "peerId", "peerRole");

-- CreateIndex
CREATE INDEX "admin_chat_messages_threadId_createdAt_idx" ON "admin_chat_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "broadcasts_organizationId_createdAt_idx" ON "broadcasts"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_chat_threads" ADD CONSTRAINT "admin_chat_threads_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_chat_threads" ADD CONSTRAINT "admin_chat_threads_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "admin_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_targetGradeId_fkey" FOREIGN KEY ("targetGradeId") REFERENCES "grade_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

