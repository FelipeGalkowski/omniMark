CREATE TYPE "MarketplaceEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');
ALTER TABLE "MarketplaceAccount"
  ADD COLUMN "environment" "MarketplaceEnvironment" NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "magaluSellerId" TEXT,
  ADD COLUMN "magaluChannelId" TEXT;
ALTER TABLE "MagaluOAuthAttempt"
  ADD COLUMN "environment" "MarketplaceEnvironment" NOT NULL DEFAULT 'PRODUCTION';
CREATE UNIQUE INDEX "MarketplaceAccount_marketplace_externalId_environment_key"
  ON "MarketplaceAccount"("marketplace", "externalId", "environment");
DROP INDEX "MarketplaceAccount_marketplace_externalId_key";
