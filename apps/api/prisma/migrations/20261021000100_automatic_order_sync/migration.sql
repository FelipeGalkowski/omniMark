ALTER TABLE "MarketplaceAccount"
  ADD COLUMN "nextSyncAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "syncAttemptAt" TIMESTAMP(3),
  ADD COLUMN "syncFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastFullSyncAt" TIMESTAMP(3);
CREATE INDEX "MarketplaceAccount_marketplace_status_nextSyncAt_idx"
  ON "MarketplaceAccount"("marketplace", "status", "nextSyncAt");
