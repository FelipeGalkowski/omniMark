ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TYPE "EmailPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
CREATE TABLE "EmailChallenge" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "purpose" "EmailPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailChallenge_tokenHash_key" ON "EmailChallenge"("tokenHash");
CREATE UNIQUE INDEX "EmailChallenge_userId_purpose_key" ON "EmailChallenge"("userId", "purpose");
CREATE INDEX "EmailChallenge_expiresAt_idx" ON "EmailChallenge"("expiresAt");
CREATE TABLE "EmailDelivery" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "challengeId" TEXT, "payloadCipher" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockId" TEXT, "lockUntil" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmailDelivery_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "EmailChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailDelivery_challengeId_key" ON "EmailDelivery"("challengeId");
CREATE INDEX "EmailDelivery_nextAttemptAt_idx" ON "EmailDelivery"("nextAttemptAt");
CREATE TABLE "EmailThrottle" ("key" TEXT NOT NULL, "nextAllowedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmailThrottle_pkey" PRIMARY KEY ("key"));
