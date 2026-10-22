import { syncAccount } from './order-sync.js'
import { syncMagaluAccount } from './magalu-sync.js'
import type { SyncAdapter } from './sync-contract.js'
import { magaluEnvironment } from './magalu-environment.js'

// Register Shopee and Amazon here when their API connectors are implemented.
// They inherit first import, periodic scheduling, reservations and retries.
export const orderSyncAdapters: SyncAdapter[] = [
  { marketplace: 'MERCADO_LIVRE', run: syncAccount },
  { marketplace: 'MAGALU', environment: magaluEnvironment().environment, run: syncMagaluAccount },
]
