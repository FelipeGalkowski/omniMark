import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { registerShopee } from './shopee.js'
import { digest, vault } from './mercadolivre.js'

const companyId = '2a741c2f-c591-41c3-9bc3-92db19003e1d', origin = 'https://stage.example.test'
const headers = { origin, cookie: 'session=original' }, crypt = vault('ab'.repeat(32))
let app: ReturnType<typeof Fastify>, db: any, provider: any, attempts: Map<string, any>
beforeEach(async () => {
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'sandbox'); vi.stubEnv('SHOPEE_PARTNER_ID', '123'); vi.stubEnv('SHOPEE_PARTNER_KEY', 'private-key')
  vi.stubEnv('SHOPEE_REDIRECT_URI', `${origin}/integrations/shopee/callback`); vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32))
  attempts = new Map()
  db = { companyMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    shopeeOAuthAttempt: {
      create: vi.fn(async ({ data }: any) => { attempts.set(data.stateHash, { codeCipher: null, denied: false, ...data }) }),
      findUnique: vi.fn(async ({ where }: any) => attempts.get(where.stateHash)),
      deleteMany: vi.fn(async ({ where }: any) => ({ count: where.stateHash ? Number(attempts.delete(where.stateHash)) : 0 })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const item = attempts.get(where.stateHash)
        if (!item || item.expiresAt <= new Date() || item.codeCipher || item.denied || item.environment !== where.environment || item.partnerId !== where.partnerId) return { count: 0 }
        Object.assign(item, data); return { count: 1 }
      }),
    }, marketplaceAccount: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'account' })), updateMany: vi.fn(async () => ({ count: 1 })) },
    marketplaceCredential: { upsert: vi.fn() } }
  db.$transaction = async (fn: any) => fn(db)
  provider = vi.fn(async () => new Response(JSON.stringify({ error: '', access_token: 'private-access', refresh_token: 'private-refresh', expire_in: 14400, shop_id: 456, partner_id: 123 })))
  app = Fastify(); await app.register(cookie)
  registerShopee(app, db, async (req: any, reply: any) => {
    if (!req.cookies.session) return reply.code(401).send({ error: 'Login necessário' })
    req.currentUser = { id: 'user' }
  }, 'session', origin, provider)
})
afterEach(async () => { await app.close(); vi.unstubAllEnvs() })
async function start() {
  const result = await app.inject({ method: 'POST', url: `/companies/${companyId}/integrations/shopee/authorize`, headers, payload: {} })
  return new URL(result.json().url).searchParams.get('state')!
}
const callback = (state: string, params = 'code=private-code&shop_id=456') => app.inject(`/integrations/shopee/callback?state=${state}&${params}`)
const complete = (state: string, extraHeaders = {}) => app.inject({ method: 'POST', url: '/integrations/shopee/complete', headers: { ...headers, ...extraHeaders }, payload: { state } })

it('requires session, company membership, administrator role and trusted origin', async () => {
  const url = `/companies/${companyId}/integrations/shopee/authorize`
  expect((await app.inject({ method: 'POST', url, headers: { origin } })).statusCode).toBe(401)
  expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://other.test' } })).statusCode).toBe(403)
  db.companyMember.findUnique.mockResolvedValue(null)
  expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(404)
  db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
  expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(403)
  expect(attempts.size).toBe(0); expect(provider).not.toHaveBeenCalled()
})
it('binds random hashed state to session/company/environment and stores encrypted code and tokens', async () => {
  const state = await start()
  expect(state).toMatch(/^[a-f0-9]{64}$/)
  expect(attempts.get(digest(state))).toMatchObject({ sessionHash: digest('original'), companyId, environment: 'SANDBOX', partnerId: '123' })
  expect((await callback(state)).headers.location).toBe(`${origin}/#shopee_state=${state}`)
  expect(JSON.parse(crypt.open(attempts.get(digest(state)).codeCipher))).toEqual({ code: 'private-code', shopId: '456' })
  expect((await complete(state, { cookie: 'session=other' })).statusCode).toBe(400)
  expect(provider).not.toHaveBeenCalled()
  const done = await complete(state)
  expect(done.json()).toEqual({ connected: true, companyId, environment: 'SANDBOX' })
  expect(done.body).not.toContain('private-')
  expect(provider).toHaveBeenCalledTimes(2)
  expect(provider.mock.calls.map(([url]: any) => url.pathname)).toEqual(['/api/v2/auth/token/get', '/api/v2/auth/access_token/get'])
  expect(db.marketplaceAccount.create.mock.calls[0][0].data).toMatchObject({ marketplace: 'SHOPEE', companyId, externalId: '456', environment: 'SANDBOX' })
  const data = db.marketplaceCredential.upsert.mock.calls[0][0].create
  expect(JSON.parse(crypt.open(data.tokenCipher))).toEqual({ accessToken: 'private-access', refreshToken: 'private-refresh', shopId: '456', partnerId: '123' })
  expect((await complete(state)).statusCode).toBe(400); expect((await callback(state)).statusCode).toBe(400)
})
it('rejects unknown, expired, incomplete, ambiguous and main-account callbacks', async () => {
  expect((await callback('ab'.repeat(32))).statusCode).toBe(400)
  const state = await start()
  expect((await complete(state)).statusCode).toBe(400)
  for (const params of ['code=x', 'code=x&shop_id=456&error=denied', 'code=x&main_account_id=99', 'code=x&shop_id=456&main_account_id=99', 'code=x&shop_id=9007199254740992']) {
    expect((await callback(state, params)).statusCode).toBe(400)
  }
  attempts.get(digest(state)).expiresAt = new Date(0)
  expect((await callback(state)).statusCode).toBe(400); expect((await complete(state)).statusCode).toBe(400)
  expect(provider).not.toHaveBeenCalled()
})
it('handles denied consent without contacting the token API', async () => {
  const state = await start(); await callback(state, 'error=access_denied')
  expect((await complete(state)).json().error).toContain('cancelada')
  expect(provider).not.toHaveBeenCalled()
})
it('rejects app/environment changes, provider-crossed state and loss of company permissions', async () => {
  expect((await complete('cd'.repeat(32))).statusCode).toBe(400)
  const state = await start(); await callback(state)
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'production')
  expect((await complete(state)).statusCode).toBe(400)
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'sandbox'); vi.stubEnv('SHOPEE_PARTNER_ID', '999')
  expect((await complete(state)).statusCode).toBe(400)
  vi.stubEnv('SHOPEE_PARTNER_ID', '123'); db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
  expect((await complete(state)).statusCode).toBe(403); expect(provider).not.toHaveBeenCalled()
})
it('refuses other companies and sync locks, and preserves the existing label/history when reconnecting', async () => {
  for (const existing of [{ id: 'account', companyId: 'other' }, { id: 'account', companyId }]) {
    const state = await start(); await callback(state)
    db.marketplaceAccount.findUnique.mockResolvedValue(existing)
    db.marketplaceAccount.updateMany.mockResolvedValue({ count: 0 })
    expect((await complete(state)).statusCode).toBe(502)
    expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
  }
  const state = await start(); await callback(state)
  db.marketplaceAccount.updateMany.mockResolvedValue({ count: 1 })
  expect((await complete(state)).statusCode).toBe(200)
  expect(db.marketplaceAccount.create).not.toHaveBeenCalled()
  const data = db.marketplaceAccount.updateMany.mock.calls.at(-1)[0].data
  expect(data).toMatchObject({ status: 'CONNECTED', nextSyncAt: expect.any(Date) })
  expect(data.label).toBeUndefined(); expect(data.lastSyncAt).toBeUndefined()
})
it('rechecks permissions inside persistence and does not expose provider errors or secrets', async () => {
  const state = await start(); await callback(state)
  db.companyMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValue({ role: 'VIEWER' })
  const result = await complete(state)
  expect(result.statusCode).toBe(502); expect(result.body).not.toMatch(/private-/)
  expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
  expect(db.marketplaceAccount.create).not.toHaveBeenCalled()
})
