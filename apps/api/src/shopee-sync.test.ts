import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { normalizeShopeeOrder, readShopeeOrders, shopeeDateRanges, syncShopeeAccount } from './shopee-sync.js'
import { shopeeConfiguration, shopeeSignedUrl } from './shopee-client.js'

const origin = 'https://stage.example.test'
const order = (order_sn = 'SN1') => ({ order_sn, region: 'BR', currency: 'BRL', order_status: 'READY_TO_SHIP',
  create_time: 1792500000, update_time: 1792500000, pay_time: 1792500000, total_amount: 99.9, actual_shipping_fee: 25,
  buyer_cpf_id: 'private-buyer', recipient_address: { full_address: 'private-address' },
  item_list: [{ item_name: 'Produto', model_quantity_purchased: 2, model_discounted_price: 49.95 }] })
const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-02T00:00:00Z')
const page = (ids: string[], more = false, next_cursor = '') => ({ order_list: ids.map(order_sn => ({ order_sn })), more, next_cursor })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
beforeEach(() => {
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'sandbox'); vi.stubEnv('SHOPEE_PARTNER_ID', '123'); vi.stubEnv('SHOPEE_PARTNER_KEY', 'test-key')
  vi.stubEnv('SHOPEE_REDIRECT_URI', `${origin}/integrations/shopee/callback`); vi.stubEnv('WEB_ORIGIN', origin); vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32))
})
afterEach(() => vi.unstubAllEnvs())

it('preserves cents and buyer-paid total without using carrier cost as buyer freight or retaining buyer data', () => {
  const normalized = normalizeShopeeOrder(order())
  expect(normalized).toMatchObject({ status: 'paid', shippingKnown: false,
    financials: { orderTotal: 99.9, paymentConfirmed: true, refundsKnown: false, returnsKnown: false, discountKnown: false } })
  expect(normalized.items[0]).toMatchObject({ qty: 2, unitPrice: 49.95 })
  expect(JSON.stringify(normalized)).not.toMatch(/private|actual_shipping_fee|buyer_cpf/)
  expect(normalizeShopeeOrder({ ...order(), order_status: 'COMPLETED' }).status).toBe('delivered')
  expect(normalizeShopeeOrder({ ...order(), order_status: 'CANCELLED' }).financials.paymentConfirmed).toBe(true)
})
it('keeps unpaid totals and bundle allocations unknown, rejects unsupported currency and statuses', () => {
  const normalized = normalizeShopeeOrder({ ...order(), order_status: 'UNPAID', pay_time: null, total_amount: undefined,
    item_list: [{ ...order().item_list[0], promotion_type: 'bundle_deal', model_discounted_price: 0 }] })
  expect(normalized).toMatchObject({ status: 'pending', items: [{ unitPrice: null }], financials: { orderTotal: null, paymentConfirmed: false } })
  for (const changes of [{ region: 'SG' }, { currency: 'USD' }, { order_status: 'UNKNOWN' }, { total_amount: -1 }]) expect(() => normalizeShopeeOrder({ ...order(), ...changes })).toThrow()
})
it('uses the BR host for production order requests and keeps the token API on its documented host', () => {
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'production')
  const config = shopeeConfiguration(origin)
  expect(shopeeSignedUrl(config, '/api/v2/order/get_order_list', { shopId: '456', accessToken: 'access' }).origin).toBe('https://openplatform.shopee.com.br')
  expect(shopeeSignedUrl(config, '/api/v2/auth/token/get').origin).toBe('https://partner.shopeemobile.com')
})
it('reads a year in valid windows, deduplicates boundaries and fetches details in batches of at most 50', async () => {
  const ranges = shopeeDateRanges(new Date('2025-10-01T00:00:00Z'), to)
  expect(ranges.length).toBeGreaterThan(20)
  expect(ranges.every(range => range.from < range.to && range.to - range.from < 15 * 86400)).toBe(true)
  for (let index = 1; index < ranges.length; index++) expect(ranges[index].from).toBe(ranges[index - 1].to)
  let listed = 0, detailCount = 0
  const get = vi.fn(async (path: string, query: URLSearchParams) => {
    if (path.endsWith('get_order_list')) {
      expect(query.get('time_range_field')).toBe('create_time'); expect(query.has('order_status')).toBe(false)
      listed++; return page(Array.from({ length: 60 }, (_, index) => `SN${index}`))
    }
    const ids = query.get('order_sn_list')!.split(','); expect(ids.length).toBeLessThanOrEqual(50); detailCount++
    expect(query.get('response_optional_fields')).toBe('item_list,pay_time,total_amount')
    expect(query.toString()).not.toMatch(/buyer|recipient|cpf/)
    return { order_list: ids.map(order) }
  })
  const result = await readShopeeOrders(get, new Date('2025-10-01T00:00:00Z'), to, false)
  expect(result).toHaveLength(60); expect(listed).toBe(ranges.length); expect(detailCount).toBe(2)
})
it('follows cursors for updated orders and rejects loops, duplicate pages and incomplete or unexpected details', async () => {
  const get = vi.fn().mockResolvedValueOnce(page(['SN1'], true, 'opaque-next')).mockResolvedValueOnce(page(['SN2']))
    .mockResolvedValueOnce({ order_list: [order('SN2'), order('SN1')] })
  expect(await readShopeeOrders(get, from, to, true)).toHaveLength(2)
  expect(get.mock.calls[1][1].get('cursor')).toBe('opaque-next')
  expect(get.mock.calls[0][1].get('time_range_field')).toBe('update_time')
  for (const next of ['', 'repeat']) {
    const bad = vi.fn().mockResolvedValueOnce(page(['SN1'], true, 'repeat')).mockResolvedValueOnce(page(['SN2'], true, next))
    await expect(readShopeeOrders(bad, from, to, false)).rejects.toThrow('paginação')
  }
  const duplicate = vi.fn().mockResolvedValueOnce(page(['SN1'], true, 'next')).mockResolvedValueOnce(page(['SN1']))
  await expect(readShopeeOrders(duplicate, from, to, false)).rejects.toThrow('mudaram')
  for (const details of [[], [order('FOREIGN')], [order(), order()]]) {
    await expect(readShopeeOrders(vi.fn().mockResolvedValueOnce(page(['SN1'])).mockResolvedValueOnce({ order_list: details }), from, to, false)).rejects.toThrow()
  }
})
it('stops above the import volume limit before requesting any details', async () => {
  let pageNumber = 0
  const get = vi.fn(async (path: string) => {
    expect(path).toBe('/api/v2/order/get_order_list')
    const start = pageNumber++ * 100
    return page(Array.from({ length: 100 }, (_, index) => `SN${start + index}`), true, String(pageNumber))
  })
  await expect(readShopeeOrders(get, from, to, false)).rejects.toThrow('excede o limite')
  expect(get).toHaveBeenCalledTimes(101)
})

function database(expired = false) {
  const config = shopeeConfiguration(origin)
  const account: any = { id: 'account', marketplace: 'SHOPEE', externalId: '456', environment: 'SANDBOX', syncLock: 'lease',
    syncLockUntil: new Date(Date.now() + 900000), syncFrom: new Date('2025-10-26'), syncTo: new Date(Date.now() - 300000), lastFullSyncAt: new Date(),
    credentials: { tokenCipher: config.crypt.seal(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', shopId: '456', partnerId: '123' })),
      expiresAt: new Date(Date.now() + (expired ? -1 : 600000)) } }
  const db: any = { marketplaceAccount: { findUniqueOrThrow: vi.fn(async () => account), updateMany: vi.fn(async () => ({ count: 1 })) },
    marketplaceCredential: { updateMany: vi.fn(async ({ data }: any) => { Object.assign(account.credentials, data); return { count: 1 } }) },
    order: { upsert: vi.fn(async () => ({ id: 'saved' })) }, orderItem: { deleteMany: vi.fn(), createMany: vi.fn() } }
  db.$transaction = vi.fn(async (fn: any) => fn(db))
  return { db, account, config }
}
it('publishes only complete imports under the lease and preserves history coverage on incremental updates', async () => {
  const { db, account } = database()
  const get = vi.fn().mockResolvedValueOnce(response({ error: '', response: page(['SN1']) })).mockResolvedValueOnce(response({ error: '', response: { order_list: [order()] } }))
  expect(await syncShopeeAccount(db, 'account', get, { lease: 'lease' })).toEqual({ orders: 1, incomplete: 1 })
  expect(db.marketplaceAccount.updateMany.mock.calls[0][0]).toMatchObject({ where: { syncLock: 'lease' }, data: { syncFrom: account.syncFrom } })
  expect(db.order.upsert.mock.calls[0][0].create).toMatchObject({ grossAmount: 99.9, snapshot: { marketplace: 'shopee' } })
  expect(JSON.stringify(db.order.upsert.mock.calls)).not.toMatch(/private/)
})
it('renews tokens before import, saves the rotation even if details fail and never publishes partial orders', async () => {
  const { db } = database(true)
  const get = vi.fn().mockResolvedValueOnce(response({ error: '', access_token: 'new', refresh_token: 'new-refresh', expire_in: 14400, shop_id: 456, partner_id: 123 }))
    .mockResolvedValueOnce(response({ error: '', response: page(['SN1']) })).mockResolvedValueOnce(response({ error: '', response: { order_list: [] } }))
  await expect(syncShopeeAccount(db, 'account', get, { lease: 'lease' })).rejects.toThrow('todos os pedidos')
  expect(db.marketplaceCredential.updateMany).toHaveBeenCalledOnce(); expect(db.$transaction).not.toHaveBeenCalled()
})
it('honors throttling, refuses environment and lease mismatches, and preserves data on denied access', async () => {
  const { db, account } = database()
  const get = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
  await expect(syncShopeeAccount(db, 'account', get, { lease: 'lease' })).rejects.toMatchObject({ code: 429, retryAfterMs: 120000 })
  expect(get).toHaveBeenCalledOnce(); expect(db.$transaction).not.toHaveBeenCalled()
  await expect(syncShopeeAccount(db, 'account', vi.fn(async () => response({ error: 'error_permission', message: 'private' })), { lease: 'lease' })).rejects.toMatchObject({ reconnect: true })
  account.environment = 'PRODUCTION'
  const unused = vi.fn(); await expect(syncShopeeAccount(db, 'account', unused, { lease: 'lease' })).rejects.toThrow('ambiente')
  expect(unused).not.toHaveBeenCalled()
})
it('refuses to publish if the lease expires after reading the provider', async () => {
  const { db } = database()
  db.marketplaceAccount.updateMany.mockResolvedValue({ count: 0 })
  const get = vi.fn().mockResolvedValueOnce(response({ error: '', response: page(['SN1']) })).mockResolvedValueOnce(response({ error: '', response: { order_list: [order()] } }))
  await expect(syncShopeeAccount(db, 'account', get, { lease: 'lease' })).rejects.toThrow('perdeu sua reserva')
  expect(db.order.upsert).not.toHaveBeenCalled(); expect(db.orderItem.deleteMany).not.toHaveBeenCalled()
})
