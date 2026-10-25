import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { seedMagaluSandbox } from './magalu-sandbox-seed.js'
import { vault } from './mercadolivre.js'
import { MAGALU_SANDBOX_CHANNEL } from './magalu-environment.js'
const key = 'ab'.repeat(32), tenant = '351d49cf-9394-4b20-8ced-be7e16d65fa5', seller = '9e0dcdef-a9ad-40f7-a739-266de26b78bc'
function database() {
  const accessToken = `header.${Buffer.from(JSON.stringify({ sub: `GENPUB.${tenant}`, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url')}.signature`
  const account = { externalId: tenant, environment: 'SANDBOX', magaluSellerId: seller, magaluChannelId: MAGALU_SANDBOX_CHANNEL,
    credentials: { tokenCipher: vault(key).seal(JSON.stringify({ accessToken, refreshToken: 'private-refresh' })), expiresAt: new Date(Date.now() + 7200000) } }
  return { db: { marketplaceAccount: { findMany: vi.fn(async () => [account]) } } as any, account }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => { vi.stubEnv('WEB_ORIGIN', 'https://teste.omnimark.tech'); vi.stubEnv('MAGALU_ENVIRONMENT', 'sandbox'); vi.stubEnv('TOKEN_ENCRYPTION_KEY', key) })
afterEach(() => vi.unstubAllEnvs())

it('never calls a provider or writes data when sandbox is disabled', async () => {
  const { db } = database(), request = vi.fn()
  vi.stubEnv('MAGALU_ENVIRONMENT', 'production')
  await expect(seedMagaluSandbox(db, 'order', request)).rejects.toThrow('stage')
  expect(db.marketplaceAccount.findMany).not.toHaveBeenCalled()
  expect(request).not.toHaveBeenCalled()
})
it('submits the documented fictitious product only when its stable SKU does not exist', async () => {
  const { db } = database()
  const request = vi.fn().mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({}, 202))
  expect(await seedMagaluSandbox(db, 'catalog', request)).toMatchObject({ state: 'product_submitted', sku: 'OMNIMARK-SANDBOX-001' })
  expect(request).toHaveBeenCalledTimes(2)
  const [url, init] = request.mock.calls[1]
  expect(url).toBe('https://api-sandbox.magalu.com/seller/v1/portfolios/skus')
  expect(new Headers(init.headers).get('X-Tenant-Id')).toBe(`GENPUB.${seller}`)
  expect(JSON.parse(init.body)).toMatchObject({ sku: 'OMNIMARK-SANDBOX-001', channels: [{ id: MAGALU_SANDBOX_CHANNEL }], title: 'Produto fictício OmniMark - Sandbox' })
})
it('prepares price and stock without recreating an existing product or creating orders', async () => {
  const { db } = database(), request = vi.fn(async () => json({}, 202))
  expect(await seedMagaluSandbox(db, 'catalog', request)).toMatchObject({ state: 'catalog_submitted' })
  expect(request.mock.calls).toHaveLength(3)
  const calls = request.mock.calls as unknown as [string, RequestInit][]
  expect(calls[1][0]).toContain('/portfolios/prices/')
  expect(calls[2][0]).toContain('/portfolios/stocks/')
  expect(calls.some(([url]) => url.includes('/samples/orders'))).toBe(false)
})
it('creates one fake order and requests approval without copying buyer information', async () => {
  const { db } = database()
  const request = vi.fn().mockResolvedValueOnce(json({ id: 'order', code: 'test-code', deliveries: [{ id: 'delivery' }], customer: { email: 'private@example.test' } }, 201))
    .mockResolvedValueOnce(json({}, 202))
  const result = await seedMagaluSandbox(db, 'order', request)
  expect(result).toMatchObject({ state: 'order_created', id: 'order', code: 'test-code', deliveryIds: ['delivery'], approval: 'requested' })
  expect(JSON.stringify(result)).not.toContain('private')
  expect(request.mock.calls[0][0]).toBe('https://api-sandbox.magalu.com/v1/samples/orders')
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ channel: { id: MAGALU_SANDBOX_CHANNEL }, payments: [{ method: 'pix' }] })
  expect(request.mock.calls[1][1].method).toBe('PUT')
})
it('does not retry creation after a failed approval and provides a separate approval operation', async () => {
  const { db } = database()
  const request = vi.fn().mockResolvedValueOnce(json({ id: 'order', code: 'test-code', deliveries: [{ id: 'delivery' }] }, 201)).mockResolvedValueOnce(json({ message: 'private-refresh rejected' }, 400))
  const result = await seedMagaluSandbox(db, 'order', request)
  expect(result).toMatchObject({ state: 'order_created', approval: 'pending' })
  expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('private-refresh')
  const approve = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({}, 202))
  expect(await seedMagaluSandbox(db, 'approve', approve, { code: 'test-code', deliveryIds: ['delivery'] })).toMatchObject({ state: 'approval_requested', code: 'test-code' })
  expect(approve).toHaveBeenCalledOnce()
  expect(approve.mock.calls[0][0]).toBe('https://api-sandbox.magalu.com/v1/samples/orders/test-code')
})
it('approves by commercial code when the provider rejects the distinct order UUID', async () => {
  const { db } = database()
  const orderId = '6bc58a36-d96c-43bf-97bd-701820195742', code = '20261024000000001'
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') return json({ id: orderId, code, deliveries: [{ id: 'delivery' }] }, 201)
    return String(input).endsWith(`/orders/${code}`) ? json({}, 202) : json({ slug: 'ORDER_NOT_FOUND' }, 400)
  })
  expect(await seedMagaluSandbox(db, 'order', request)).toMatchObject({ id: orderId, code, approval: 'requested' })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][0]).toBe(`https://api-sandbox.magalu.com/v1/samples/orders/${code}`)
})
it('keeps approval pending instead of substituting the UUID when the creation response has no code', async () => {
  const { db } = database()
  const request = vi.fn(async () => json({ id: 'uuid-order', deliveries: [{ id: 'delivery' }] }, 201))
  const result = await seedMagaluSandbox(db, 'order', request)
  expect(result).toMatchObject({ state: 'order_created', id: 'uuid-order', approval: 'pending' })
  expect(result.message).toContain('campo code')
  expect(request).toHaveBeenCalledOnce()
})
