ALTER TABLE "MarketplaceAccount"
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "syncFrom" TIMESTAMP(3),
  ADD COLUMN "syncTo" TIMESTAMP(3),
  ADD COLUMN "syncError" TEXT,
  ADD COLUMN "syncLock" TEXT,
  ADD COLUMN "syncLockUntil" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "snapshot" JSONB;
