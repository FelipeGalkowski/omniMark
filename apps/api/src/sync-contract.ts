import type { Marketplace, MarketplaceEnvironment, PrismaClient } from '@prisma/client'

export type SyncExecution = { lease: string }
export type SyncResult = { orders: number; incomplete: number }
// New marketplaces implement this contract; scheduling, retries and leases stay shared.
export type SyncAdapter = {
  marketplace: Marketplace
  environment?: MarketplaceEnvironment
  run(db: PrismaClient, accountId: string, request: typeof fetch, execution: SyncExecution): Promise<SyncResult>
}
