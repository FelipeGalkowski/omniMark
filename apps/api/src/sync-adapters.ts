import { syncAccount } from './order-sync.js'
import { syncMagaluAccount } from './magalu-sync.js'
import type { SyncAdapter } from './sync-contract.js'
import { magaluEnvironment } from './magalu-environment.js'
import { syncShopeeAccount } from './shopee-sync.js'
import { shopeeEnvironment } from './shopee-client.js'

// Register Amazon here when its API connector is implemented.
// They inherit first import, periodic scheduling, reservations and retries.
export const orderSyncAdapters: SyncAdapter[] = [
  { marketplace: 'MERCADO_LIVRE', run: syncAccount },
  { marketplace: 'MAGALU', environment: magaluEnvironment().environment, run: syncMagaluAccount },
  { marketplace: 'SHOPEE', environment: shopeeEnvironment().environment, run: syncShopeeAccount },
]
