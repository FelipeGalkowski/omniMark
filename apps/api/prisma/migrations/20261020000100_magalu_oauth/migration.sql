CREATE TABLE "MagaluOAuthAttempt" (
  "stateHash" TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "codeCipher" TEXT,
  "denied" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MagaluOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "MagaluOAuthAttempt_expiresAt_idx" ON "MagaluOAuthAttempt"("expiresAt");
