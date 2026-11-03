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
  expect(JSON.parse(crypt.open(attempts.get(digest(state)).codeCipher))).toEqual({ code: 'private-code', shopId: '456', receivedAt: expect.any(Number) })
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

it('identifies exchange failures without exposing provider payloads', async () => {
  const state = await start(); await callback(state)
  provider.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'private-key', message: 'private-code', access_token: 'private-access' })))
  const result = await complete(state)
  expect(result.statusCode).toBe(502)
  expect(result.json().error).toContain('troca do código por acesso')
  expect(result.json().error).toContain('recusa de autorização')
  expect(result.body).not.toContain('private-')
  expect(provider).toHaveBeenCalledTimes(1)
  expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
})

it('distinguishes initial refresh schema failures from exchange failures', async () => {
  const state = await start(); await callback(state)
  provider.mockResolvedValueOnce(new Response(JSON.stringify({ error: '', access_token: 'private-access', refresh_token: 'private-refresh', expire_in: 14400 })))
  provider.mockResolvedValueOnce(new Response(JSON.stringify({ error: '', access_token: 'private-access', expire_in: 'private-secret' })))
  const result = await complete(state)
  expect(result.json().error).toContain('renovação inicial e confirmação da loja')
  expect(result.json().error).toContain('formato esperado')
  expect(result.body).not.toContain('private-')
  expect(db.marketplaceAccount.create).not.toHaveBeenCalled()
})

it('reports HTTP status but hides raw persistence and network errors', async () => {
  let state = await start(); await callback(state)
  provider.mockResolvedValueOnce(new Response('private-secret', { status: 403 }))
  let result = await complete(state)
  expect(result.json().error).toContain('HTTP 403')
  expect(result.body).not.toContain('private-')
  state = await start(); await callback(state)
  provider.mockRejectedValueOnce(new Error('private-key'))
  result = await complete(state)
  expect(result.json().error).toContain('troca do código por acesso')
  expect(result.body).not.toContain('private-')
  state = await start(); await callback(state)
  db.marketplaceAccount.create.mockRejectedValueOnce(new Error('private-database-url'))
  result = await complete(state)
  expect(result.json().error).toContain('gravação da conexão')
  expect(result.body).not.toContain('private-')
})

it('preserves an encoded callback code through encryption and the production token request', async () => {
  vi.stubEnv('SHOPEE_ENVIRONMENT', 'production')
  const state = await start()
  const code = 'private-code+A/B=%2B_abc-123'
  const returned = await callback(state, new URLSearchParams({ code, shop_id: '456' }).toString())
  expect(returned.statusCode).toBe(302)
  expect((await complete(state)).statusCode).toBe(200)
  const [url, init] = provider.mock.calls[0]
  expect(url.origin + url.pathname).toBe('https://partner.shopeemobile.com/api/v2/auth/token/get')
  expect(JSON.parse(init.body)).toEqual({ code, partner_id: 123, shop_id: 456 })
  expect(url.searchParams.get('partner_id')).toBe('123')
})

it('exchanges a callback only once under concurrent completion even when Shopee refuses its code', async () => {
  const state = await start(); await callback(state)
  provider.mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid_code', message: 'Invalid code' }), { status: 403 }))
  const results = await Promise.all([complete(state), complete(state)])
  expect(results.map(result => result.statusCode).sort()).toEqual([400, 502])
  expect(provider).toHaveBeenCalledTimes(1)
  expect(db.marketplaceAccount.create).not.toHaveBeenCalled()
  expect((await callback(state)).statusCode).toBe(400)
  expect((await complete(state)).statusCode).toBe(400)
  expect(provider).toHaveBeenCalledTimes(1)
})

it('reports callback delay and a constrained provider reference without disclosing secrets', async () => {
  const state = await start(); await callback(state)
  const attempt = attempts.get(digest(state))
  const payload = JSON.parse(crypt.open(attempt.codeCipher))
  attempt.codeCipher = crypt.seal(JSON.stringify({ ...payload, receivedAt: Date.now() - 3000 }))
  provider.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_code', message: 'Invalid code private-code',
    request_id: '0123456789abcdef0123456789abcdef' }), { status: 403 }))
  const result = await complete(state)
  expect(result.json().error).toMatch(/Retorno até troca: [34]s/)
  expect(result.json().error).toContain('Referência Shopee: 0123456789abcdef0123456789abcdef')
  expect(result.body).not.toContain('private-')
})

it('omits untrusted references and accepts pending callbacks from the preceding deployment', async () => {
  const state = await start(); await callback(state)
  attempts.get(digest(state)).codeCipher = crypt.seal(JSON.stringify({ code: 'private-code', shopId: '456' }))
  provider.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_code', request_id: 'private-access-token' }), { status: 403 }))
  const result = await complete(state)
  expect(result.json().error).toContain('Retorno até troca: indisponível')
  expect(result.json().error).toContain('Referência Shopee: indisponível')
  expect(result.body).not.toContain('private-')
})
