DROP INDEX "attendance_sessions_tokenHash_key";

ALTER TABLE "attendance_sessions" DROP COLUMN "tokenHash",
ADD COLUMN     "token" TEXT NOT NULL;

CREATE UNIQUE INDEX "attendance_sessions_token_key" ON "attendance_sessions"("token");
