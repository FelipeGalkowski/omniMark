import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { shopeeConfiguration, shopeeEnvironment, shopeeAuthorizationUrl, shopeeSignedUrl,
  exchangeShopeeCode, refreshShopeeTokens, refreshShopeeCredential } from './shopee-client.js'

const origin = 'https://stage.example.test'
const token = () => ({ error: '', message: '', access_token: 'private-access', refresh_token: 'private-refresh', expire_in: 14400 })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const stored = () => ({ accessToken: 'old-access', refreshToken: 'old-refresh', shopId: '456', partnerId: '123' })
beforeEach(() => {
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'sandbox'); vi.stubEnv('SHOPEE_PARTNER_ID', '123'); vi.stubEnv('SHOPEE_PARTNER_KEY', 'partner-test')
  vi.stubEnv('SHOPEE_REDIRECT_URI', `${origin}/integrations/shopee/callback`); vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32))
})
afterEach(() => vi.unstubAllEnvs())

it('uses the documented BR authorization hosts and isolated API environments', () => {
  expect(shopeeEnvironment()).toEqual({ environment: 'SANDBOX', authorizationUrl: 'https://open.sandbox.test-stable.shopee.com.br/auth',
    baseUrl: 'https://openplatform.sandbox.test-stable.shopee.sg' })
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'production')
  expect(shopeeEnvironment()).toEqual({ environment: 'PRODUCTION', authorizationUrl: 'https://open.shopee.com.br/auth',
    baseUrl: 'https://partner.shopeemobile.com' })
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'unexpected')
  expect(() => shopeeEnvironment()).toThrow()
})

it('requires an exact HTTPS callback, safe numeric IDs and encryption key', () => {
  for (const redirect of ['http://stage.example.test/integrations/shopee/callback', 'https://other.test/integrations/shopee/callback',
    `${origin}/wrong`, `${origin}/integrations/shopee/callback?extra=1`, `${origin}/integrations/shopee/callback#secret`,
    'https://user:password@stage.example.test/integrations/shopee/callback']) {
    vi.stubEnv('SHOPEE_REDIRECT_URI', redirect)
    expect(() => shopeeConfiguration(origin)).toThrow()
  }
  vi.stubEnv('SHOPEE_REDIRECT_URI', `${origin}/integrations/shopee/callback`)
  for (const id of ['0', '00123', '-1', '9007199254740992', 'not-an-id']) {
    vi.stubEnv('SHOPEE_PARTNER_ID', id); expect(() => shopeeConfiguration(origin)).toThrow()
  }
  vi.stubEnv('SHOPEE_PARTNER_ID', '123'); vi.stubEnv('TOKEN_ENCRYPTION_KEY', '')
  expect(() => shopeeConfiguration(origin)).toThrow()
})

it('generates the current authorization link with state and no partner key', () => {
  const state = 'ab'.repeat(32)
  const url = new URL(shopeeAuthorizationUrl(shopeeConfiguration(origin), state))
  expect(url.origin + url.pathname).toBe('https://open.sandbox.test-stable.shopee.com.br/auth')
  expect(Object.fromEntries(url.searchParams)).toEqual({ partner_id: '123', auth_type: 'seller',
    redirect_uri: `${origin}/integrations/shopee/callback`, response_type: 'code', state })
  expect(url.href).not.toContain('partner-test')
  expect(() => shopeeAuthorizationUrl(shopeeConfiguration(origin), 'invalid')).toThrow()
})

it('signs public and shop API requests separately and refuses arbitrary paths', () => {
  const config = shopeeConfiguration(origin)
  const publicUrl = shopeeSignedUrl(config, '/api/v2/auth/token/get', undefined, 1700000000)
  expect(publicUrl.searchParams.get('sign')).toBe('ad825623413c1bd64a5d5b3e519b567717e999559d9af513418c010c248e18bf')
  expect(publicUrl.searchParams.has('access_token')).toBe(false)
  const shopUrl = shopeeSignedUrl(config, '/api/v2/order/get_order_list', { shopId: '456', accessToken: 'access-test' }, 1700000000)
  expect(shopUrl.searchParams.get('sign')).toBe('0bff6d14ab051e9f2dff17c82849235fc11d1a0d1f551f1b1dcea5cf34e20992')
  expect(shopUrl.searchParams.get('shop_id')).toBe('456')
  expect(shopUrl.origin).toBe('https://openplatform.sandbox.test-stable.shopee.sg')
  for (const path of ['https://other.test/api/v2/auth/token/get', '//other.test', '/api/v2/../auth/token/get', '/api/v2/auth/token/get?x=1']) {
    expect(() => shopeeSignedUrl(config, path)).toThrow()
  }
})

it('exchanges a shop code using a signed JSON POST and top-level tokens', async () => {
  const config = shopeeConfiguration(origin)
  const request = vi.fn(async () => response(token()))
  const before = Date.now()
  const result = await exchangeShopeeCode(config, 'private-code', '456', request)
  const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.pathname).toBe('/api/v2/auth/token/get')
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' } })
  expect(JSON.parse(String(init.body))).toEqual({ partner_id: 123, shop_id: 456, code: 'private-code' })
  expect(result.tokens).toEqual({ accessToken: 'private-access', refreshToken: 'private-refresh', shopId: '456', partnerId: '123' })
  expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 14400000)
  expect(request).toHaveBeenCalledOnce()
})

it('uses and returns the new refresh token, checking the shop and partner identities', async () => {
  const config = shopeeConfiguration(origin)
  const request = vi.fn(async () => response({ ...token(), shop_id: 456, partner_id: 123 }))
  const result = await refreshShopeeTokens(config, stored(), request)
  const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.pathname).toBe('/api/v2/auth/access_token/get')
  expect(JSON.parse(String(init.body))).toEqual({ partner_id: 123, shop_id: 456, refresh_token: 'old-refresh' })
  expect(result.tokens.refreshToken).toBe('private-refresh')
  await expect(refreshShopeeTokens(config, { ...stored(), partnerId: '999' }, request)).rejects.toThrow('aplicativo Shopee mudou')
  expect(request).toHaveBeenCalledOnce()
  for (const identity of [{ shop_id: 999, partner_id: 123 }, { shop_id: 456, partner_id: 999 }, {}]) {
    await expect(refreshShopeeTokens(config, stored(), vi.fn(async () => response({ ...token(), ...identity })))).rejects.toMatchObject({ reconnect: true })
  }
})

it.each([
  { ...token(), error: 'error_auth', message: 'private-provider-message' },
  { ...token(), expire_in: 0 }, { ...token(), access_token: '' }, { response: token() },
  { ...token(), shop_id: 999 }, { ...token(), partner_id: 999 },
])('rejects invalid/refused responses without exposing credentials', async payload => {
  const request = vi.fn(async () => response(payload))
  let failure: unknown
  try { await exchangeShopeeCode(shopeeConfiguration(origin), 'private-code', '456', request) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).not.toMatch(/private-|partner-test/)
  expect(request).toHaveBeenCalledOnce()
})

it('does not automatically repeat single-use operations on HTTP, network or JSON errors', async () => {
  for (const request of [vi.fn(async () => response({ message: 'private-message' }, 500)),
    vi.fn(async () => { throw new Error('private-url-with-token') }), vi.fn(async () => new Response('not json'))]) {
    await expect(exchangeShopeeCode(shopeeConfiguration(origin), 'private-code', '456', request)).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
  }
  const request = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
  await expect(refreshShopeeTokens(shopeeConfiguration(origin), stored(), request)).rejects.toMatchObject({ code: 429, retryAfterMs: 120000, reconnect: false })
})

function database() {
  const config = shopeeConfiguration(origin)
  const account: any = { id: 'account', marketplace: 'SHOPEE', externalId: '456', environment: 'SANDBOX', syncLock: 'lease',
    syncLockUntil: new Date(Date.now() + 600000), credentials: { tokenCipher: config.crypt.seal(JSON.stringify(stored())) } }
  const db: any = { marketplaceAccount: { findUniqueOrThrow: vi.fn(async () => account) },
    marketplaceCredential: { updateMany: vi.fn(async () => ({ count: 1 })) } }
  return { config, account, db }
}

it('persists rotated tokens encrypted with a credential comparison and an active lease', async () => {
  const { config, account, db } = database()
  const request = vi.fn(async () => response({ ...token(), shop_id: 456, partner_id: 123 }))
  await refreshShopeeCredential(db, 'account', config, { lease: 'lease' }, request)
  const saved = db.marketplaceCredential.updateMany.mock.calls[0][0]
  expect(saved.where).toMatchObject({ accountId: 'account', tokenCipher: account.credentials.tokenCipher,
    account: { syncLock: 'lease', syncLockUntil: { gt: expect.any(Date) }, environment: 'SANDBOX', marketplace: 'SHOPEE' } })
  expect(JSON.parse(config.crypt.open(saved.data.tokenCipher))).toEqual({ ...stored(), accessToken: 'private-access', refreshToken: 'private-refresh' })
  expect(saved.data.tokenCipher).not.toContain('private-')
  expect(saved.data.expiresAt).toBeInstanceOf(Date)
})

it('refuses other environments, stale leases and credentials for another shop before contacting the provider', async () => {
  for (const change of [{ environment: 'PRODUCTION' }, { syncLock: 'other' }, { syncLockUntil: new Date(0) },
    { marketplace: 'MAGALU' }, { externalId: '999' }, { credentials: null }]) {
    const { config, account, db } = database(); Object.assign(account, change)
    const request = vi.fn()
    await expect(refreshShopeeCredential(db, 'account', config, { lease: 'lease' }, request)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled(); expect(db.marketplaceCredential.updateMany).not.toHaveBeenCalled()
  }
})

it('does not overwrite concurrent credential changes and preserves stored tokens on provider failure', async () => {
  const { config, db } = database()
  db.marketplaceCredential.updateMany.mockResolvedValue({ count: 0 })
  const request = vi.fn(async () => response({ ...token(), shop_id: 456, partner_id: 123 }))
  await expect(refreshShopeeCredential(db, 'account', config, { lease: 'lease' }, request)).rejects.toThrow('alterada durante')
  db.marketplaceCredential.updateMany.mockClear()
  await expect(refreshShopeeCredential(db, 'account', config, { lease: 'lease' }, vi.fn(async () => response({}, 503)))).rejects.toThrow()
  expect(db.marketplaceCredential.updateMany).not.toHaveBeenCalled()
})
