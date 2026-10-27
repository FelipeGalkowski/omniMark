CREATE TABLE "ShopeeOAuthAttempt" (
  "stateHash" TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "environment" "MarketplaceEnvironment" NOT NULL,
  "codeCipher" TEXT,
  "denied" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopeeOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "ShopeeOAuthAttempt_expiresAt_idx" ON "ShopeeOAuthAttempt"("expiresAt");
-- Missing provider amounts remain unknown; do not replace them with zero.
ALTER TABLE "Order" ALTER COLUMN "grossAmount" DROP NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "unitPrice" DROP NOT NULL;
