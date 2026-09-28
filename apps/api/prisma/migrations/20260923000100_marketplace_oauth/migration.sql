CREATE TABLE "MarketplaceCredential" (
  "accountId" TEXT NOT NULL,
  "tokenCipher" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceCredential_pkey" PRIMARY KEY ("accountId")
);
ALTER TABLE "MarketplaceCredential" ADD CONSTRAINT "MarketplaceCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketplaceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "OAuthAttempt" (
  "stateHash" TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "verifierCipher" TEXT NOT NULL,
  "codeCipher" TEXT,
  "denied" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");
