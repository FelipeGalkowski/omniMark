import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { normalizeMagaluOrder, readMagaluOrders, syncMagaluAccount } from './magalu-sync.js'
import { MAGALU_SCOPES } from './magalu.js'
import { vault } from './mercadolivre.js'
import { MAGALU_SANDBOX_CHANNEL } from './magalu-environment.js'

const tenant = 'c36f9d61-241d-43c6-87ed-2faac6dc8ab1', key = 'ab'.repeat(32)
const jwt = () => `header.${Buffer.from(JSON.stringify({ sub: `GENPUB.${tenant}`, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url')}.signature`
const order = (code = '123') => ({ code, purchased_at: '2026-10-20T15:00:00Z', approved_at: '2026-10-20T15:01:00Z', status: 'approved',
  amounts: { currency: 'BRL', normalizer: 100, total: 19000, freight: { currency: 'BRL', normalizer: 100, total: 1000 } },
  customer: { email: 'private@example.test', address: 'private address' },
  deliveries: [{ id: 'delivery', seller: { id: `GENPUB.${tenant}` }, status: 'approved',
    items: [{ quantity: 2, info: { name: 'Produto' }, unit_price: { currency: 'BRL', normalizer: 100, value: 10000 } }] }],
})
const page = (results: unknown[] = [], offset = 0, next: string | null = null) => ({ results, meta: { page: { offset, limit: 50, count: results.length }, links: { next } } })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function database(expired = false) {
  const account: any = { id: 'account', marketplace: 'MAGALU', externalId: tenant, syncLock: 'lease', syncLockUntil: new Date(Date.now() + 900000),
    credentials: { tokenCipher: vault(key).seal(JSON.stringify({ accessToken: jwt(), refreshToken: 'private-refresh' })), expiresAt: new Date(Date.now() + (expired ? -1 : 600000)) } }
  const db: any = {
    marketplaceAccount: { findUniqueOrThrow: vi.fn(async () => account), updateMany: vi.fn(async () => ({ count: 1 })) },
    marketplaceCredential: { updateMany: vi.fn(async () => ({ count: 1 })) },
    order: { upsert: vi.fn(async () => ({ id: 'saved' })) }, orderItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  }
  db.$transaction = vi.fn(async (fn: any) => fn(db))
  return { db, account }
}
beforeEach(() => { vi.stubEnv('MAGALU_ENVIRONMENT', 'production'); vi.stubEnv('TOKEN_ENCRYPTION_KEY', key); vi.stubEnv('MAGALU_CLIENT_ID', 'client'); vi.stubEnv('MAGALU_CLIENT_SECRET', 'private-client-secret') })
afterEach(() => vi.unstubAllEnvs())

it('normalizes documented Magalu amounts, avoids counting freight twice and excludes buyer data', () => {
  const normalized = normalizeMagaluOrder(order(), tenant)
  expect(normalized).toMatchObject({ id: '123', marketplace: 'magalu', status: 'paid', shipping: 10, shippingKnown: true,
    items: [{ name: 'Produto', qty: 2, unitPrice: 100 }], financials: { productsTotal: 180, refundsKnown: false, returnsKnown: false } })
  expect(normalized.financials.productsTotal + normalized.shipping).toBe(190)
  expect(JSON.stringify(normalized)).not.toContain('private')
  const delivered = order(); delivered.deliveries[0].status = 'delivered'
  expect(normalizeMagaluOrder(delivered, tenant).status).toBe('delivered')
  expect(normalizeMagaluOrder({ ...order(), status: 'cancelled' }, tenant).status).toBe('cancelled')
  const missingFreight = order(); delete (missingFreight.amounts as any).freight
  expect(normalizeMagaluOrder(missingFreight, tenant).shippingKnown).toBe(false)
})
it('rejects other shops, unsupported statuses, invalid currency and invalid normalizers', () => {
  const other = order(); other.deliveries[0].seller.id = 'GENPUB.other'
  expect(() => normalizeMagaluOrder(other, tenant)).toThrow('outra loja')
  expect(() => normalizeMagaluOrder({ ...order(), status: 'new-unknown-status' }, tenant)).toThrow()
  for (const amounts of [{ ...order().amounts, currency: 'USD' }, { ...order().amounts, normalizer: 0 }]) expect(() => normalizeMagaluOrder({ ...order(), amounts }, tenant)).toThrow()
})
it('paginates with fixed host and date filters, using modification dates for incremental updates', async () => {
  const get = vi.fn().mockResolvedValueOnce(page([order('1')], 0, '?_offset=1&_limit=50')).mockResolvedValueOnce(page([order('2')], 1))
  const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-21T00:00:00Z')
  expect(await readMagaluOrders(get, from, to, true)).toHaveLength(2)
  const params = new URL(get.mock.calls[1][0], 'https://api.magalu.com').searchParams
  expect(params.get('updated_at__gte')).toBe(from.toISOString()); expect(params.get('updated_at__lte')).toBe(to.toISOString())
  expect(params.get('_offset')).toBe('1'); expect(params.has('purchased_at__gte')).toBe(false)
})
it('refuses repeated pages, foreign pagination URLs and missing pages before publishing', async () => {
  for (const next of ['https://attacker.example/seller/v1/orders?_offset=1', '?_offset=0']) {
    const get = vi.fn(async () => page([order()], 0, next))
    await expect(readMagaluOrders(get, new Date(), new Date(), false)).rejects.toThrow('paginação inválida')
    expect(get).toHaveBeenCalledOnce()
  }
  const duplicate = vi.fn().mockResolvedValueOnce(page([order()], 0, '?_offset=1')).mockResolvedValueOnce(page([order()], 1))
  await expect(readMagaluOrders(duplicate, new Date(), new Date(), false)).rejects.toThrow('mudaram')
  const { db } = database()
  const request = vi.fn().mockResolvedValueOnce(response(page([order()], 0, '?_offset=1'))).mockResolvedValueOnce(response({}, 400))
  await expect(syncMagaluAccount(db, 'account', request, { lease: 'lease' })).rejects.toThrow()
  expect(db.$transaction).not.toHaveBeenCalled(); expect(db.order.upsert).not.toHaveBeenCalled()
})
it('refreshes and saves rotated credentials before the API call, imports atomically and marks financial gaps', async () => {
  const { db } = database(true)
  const request = vi.fn().mockResolvedValueOnce(response({ access_token: jwt(), refresh_token: 'rotated', token_type: 'Bearer', expires_in: 7200, scope: MAGALU_SCOPES.join(' ') }))
    .mockResolvedValueOnce(response(page([order()])))
  expect(await syncMagaluAccount(db, 'account', request, { lease: 'lease' })).toEqual({ orders: 1, incomplete: 1 })
  expect(request.mock.calls[0][0]).toBe('https://id.magalu.com/oauth/token')
  expect(request.mock.calls[0][1].body.get('grant_type')).toBe('refresh_token')
  expect(new Headers(request.mock.calls[1][1].headers).get('X-Tenant-Id')).toBe(`GENPUB.${tenant}`)
  expect(new Headers(request.mock.calls[0][1].headers).has('X-Tenant-Id')).toBe(false)
  const cipher = db.marketplaceCredential.updateMany.mock.calls[0][0].data.tokenCipher
  expect(JSON.parse(vault(key).open(cipher)).refreshToken).toBe('rotated')
  expect(db.order.upsert).toHaveBeenCalledOnce()
  expect(db.order.upsert.mock.calls[0][0].create.grossAmount).toBe(190)
  expect(JSON.stringify(db.order.upsert.mock.calls)).not.toContain('private')
  expect(db.marketplaceAccount.updateMany.mock.calls[0][0].data.lastFullSyncAt).toBeInstanceOf(Date)
})
it('uses incremental queries after the initial history and preserves coverage', async () => {
  const { db, account } = database()
  account.lastFullSyncAt = new Date(); account.syncTo = new Date(Date.now() - 300000); account.syncFrom = new Date('2025-10-21T00:00:00Z')
  const request = vi.fn(async (_input: string | URL | Request) => response(page()))
  await syncMagaluAccount(db, 'account', request, { lease: 'lease' })
  expect(String(request.mock.calls[0][0])).toContain('updated_at__gte=')
  expect(db.marketplaceAccount.updateMany.mock.calls[0][0].data.syncFrom).toEqual(account.syncFrom)
  expect(db.marketplaceAccount.updateMany.mock.calls[0][0].data.lastFullSyncAt).toBeUndefined()
})
it('requires reconnection for revocation and passes provider throttling to the scheduler', async () => {
  const expired = database(true)
  await expect(syncMagaluAccount(expired.db, 'account', vi.fn(async () => response({ error: 'invalid_grant', private: 'must-not-echo' }, 400)), { lease: 'lease' })).rejects.toMatchObject({ reconnect: true })
  const { db } = database()
  await expect(syncMagaluAccount(db, 'account', vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '900' } })), { lease: 'lease' })).rejects.toMatchObject({ code: 429, retryAfterMs: 900000 })
  expect(db.order.upsert).not.toHaveBeenCalled()
})
it('does not write orders after losing its lease or when the token belongs to another shop', async () => {
  const { db } = database()
  db.marketplaceAccount.updateMany.mockResolvedValue({ count: 0 })
  await expect(syncMagaluAccount(db, 'account', vi.fn(async () => response(page([order()]))), { lease: 'lease' })).rejects.toThrow('reserva')
  expect(db.order.upsert).not.toHaveBeenCalled()
  const other = database(); other.account.externalId = 'other'
  const request = vi.fn()
  await expect(syncMagaluAccount(other.db, 'account', request, { lease: 'lease' })).rejects.toMatchObject({ reconnect: true })
  expect(request).not.toHaveBeenCalled()
})

it.each([400, 404, 422])('retains the original HTTP %i in safe order diagnostics without publishing partial imports', async status => {
  const { db } = database()
  const request = vi.fn(async () => response({ detail: [{ loc: ['query', 'purchased_at__gte', 'private-field'], msg: 'private customer@example.test token', input: jwt(), type: 'private' }], customer: { name: 'private customer' } }, status))
  const failure = await syncMagaluAccount(db, 'account', request, { lease: 'lease' }).catch(error => error)
  expect(failure).toMatchObject({ code: 502, reconnect: false, diagnostic: { reference: expect.any(String), operation: 'magalu.orders.list', providerStatus: status, detail: 'Campos rejeitados: purchased_at__gte.' } })
  expect(JSON.stringify(failure.diagnostic)).not.toMatch(/private|customer|header\./)
  expect(db.$transaction).not.toHaveBeenCalled()
})

it('diagnoses expired refresh authorization without copying provider messages or secrets', async () => {
  const { db } = database(true)
  const failure = await syncMagaluAccount(db, 'account', vi.fn(async () => response({ error: 'invalid_grant', error_description: 'private-refresh customer@example.test' }, 400)), { lease: 'lease' }).catch(error => error)
  expect(failure).toMatchObject({ reconnect: true, diagnostic: { operation: 'magalu.oauth.refresh', providerStatus: 400, detail: 'OAuth: invalid_grant.' } })
  expect(JSON.stringify(failure.diagnostic)).not.toMatch(/private|customer/)
  expect(db.$transaction).not.toHaveBeenCalled()
})

it('reads standard Magalu details and request ID without logging arbitrary fields, rules, messages or inputs', async () => {
  const { db } = database()
  const providerReference = 'cdd729b7-5407-4c55-a02c-91f67c238435'
  const request = vi.fn(async () => new Response(JSON.stringify({ slug: 'UNPROCESSABLE_ENTITY', message: 'private message', details: [
    { field: 'query._limit', slug: 'INVALID_PARAMETER_VALUE', message: jwt(), input: 'private customer' },
    { field: 'private-field', slug: 'PRIVATE_SECRET', message: 'private-refresh' },
  ] }), { status: 422, headers: { 'x-request-id': providerReference } }))
  const failure = await syncMagaluAccount(db, 'account', request, { lease: 'lease' }).catch(error => error)
  expect(failure.diagnostic).toEqual({ reference: providerReference, operation: 'magalu.orders.list', providerStatus: 422,
    detail: 'Campos rejeitados: _limit. Regras: INVALID_PARAMETER_VALUE, UNPROCESSABLE_ENTITY.' })
  expect(JSON.stringify(failure.diagnostic)).not.toMatch(/private|PRIVATE|header\./)
  expect(db.$transaction).not.toHaveBeenCalled()
})

it.each([false, true])('sends the authenticated tenant on every order page, including incremental=%s', async incremental => {
  const { db, account } = database()
  if (incremental) { account.lastFullSyncAt = new Date(); account.syncTo = new Date(Date.now() - 300000) }
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (headers.get('X-Tenant-Id') !== `GENPUB.${tenant}`) return response({ detail: [{ loc: ['header', 'X-Tenant-Id'], type: 'missing', msg: 'Field required' }] }, 422)
    expect(headers.get('Authorization')).toMatch(/^Bearer header\./)
    const offset = new URL(String(input)).searchParams.get('_offset')
    return offset === '0' ? response(page([order('1')], 0, '?_offset=1&_limit=50')) : response(page([order('2')], 1))
  })
  expect(await syncMagaluAccount(db, 'account', request, { lease: 'lease' })).toEqual({ orders: 2, incomplete: 2 })
  expect(request).toHaveBeenCalledTimes(2)
  expect(db.order.upsert).toHaveBeenCalledTimes(2)
})

it.each([
  { detail: [{ loc: ['header', 'X-Tenant-Id'], type: 'missing' }] },
  { details: [{ loc: ['header', 'X-Tenant-Id'], type: 'missing' }] },
  { details: [{ location: ['header', 'X-Tenant-Id'], type: 'missing' }] },
  { details: [{ location: 'header', field: 'X-Tenant-Id' }] },
])('identifies the missing tenant header in validation metadata: %j', async payload => {
  const { db } = database()
  const failure = await syncMagaluAccount(db, 'account', vi.fn(async () => response(payload, 422)), { lease: 'lease' }).catch(error => error)
  expect(failure.diagnostic.detail).toBe('Campos rejeitados: X-Tenant-Id.')
  expect(db.$transaction).not.toHaveBeenCalled()
})

it('imports sandbox pages from the sandbox host using the onboarded seller while retaining the personal authorization identity', async () => {
  vi.stubEnv('MAGALU_ENVIRONMENT', 'sandbox')
  const { db, account } = database()
  const seller = '9e0dcdef-a9ad-40f7-a739-266de26b78bc'
  Object.assign(account, { environment: 'SANDBOX', magaluSellerId: seller, magaluChannelId: MAGALU_SANDBOX_CHANNEL })
  const sandboxOrder = order(); sandboxOrder.deliveries[0].seller.id = `GENPUB.${seller}`
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(new URL(String(input)).origin).toBe('https://api-sandbox.magalu.com')
    expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe(`GENPUB.${seller}`)
    expect(new Headers(init?.headers).get('X-Channel-Id')).toBe(MAGALU_SANDBOX_CHANNEL)
    return response(page([sandboxOrder]))
  })
  expect(await syncMagaluAccount(db, 'account', request, { lease: 'lease' })).toEqual({ orders: 1, incomplete: 1 })
  expect(db.order.upsert).toHaveBeenCalledOnce()
})
it('refuses production credentials in sandbox mode and refuses pagination crossing environments', async () => {
  vi.stubEnv('MAGALU_ENVIRONMENT', 'sandbox')
  const { db } = database(), request = vi.fn()
  await expect(syncMagaluAccount(db, 'account', request, { lease: 'lease' })).rejects.toMatchObject({ reconnect: true })
  expect(request).not.toHaveBeenCalled()
  const get = vi.fn(async () => page([order()], 0, 'https://api.magalu.com/seller/v1/orders?_offset=1'))
  await expect(readMagaluOrders(get, new Date(), new Date(), false, 'https://api-sandbox.magalu.com')).rejects.toThrow('paginação inválida')
})
