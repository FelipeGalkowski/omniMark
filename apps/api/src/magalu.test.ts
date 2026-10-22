import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { MAGALU_SCOPES, magaluConfiguration, magaluTenant, registerMagalu } from './magalu.js'
import { digest, vault } from './mercadolivre.js'

const companyId = '2a741c2f-c591-41c3-9bc3-92db19003e1d'
const tenant = '351d49cf-9394-4b20-8ced-be7e16d65fa5'
const origin = 'https://stage.example.test'
const crypt = vault('ab'.repeat(32))
const jwt = (sub = `GENPUB.${tenant}`, exp = Math.floor(Date.now() / 1000) + 7200) => `header.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.signature`
const token = () => ({ access_token: jwt(), refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 7200, scope: MAGALU_SCOPES.join(' ') })
let app: ReturnType<typeof Fastify>
let db: any
let provider: any
let attempts: Map<string, any>
const headers = { origin, cookie: 'session=original' }
beforeEach(async () => {
  vi.stubEnv('MAGALU_CLIENT_ID', 'client-test'); vi.stubEnv('MAGALU_CLIENT_SECRET', 'secret-test')
  vi.stubEnv('MAGALU_REDIRECT_URI', `${origin}/integrations/magalu/callback`)
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32))
  attempts = new Map()
  db = {
    companyMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    magaluOAuthAttempt: {
      create: vi.fn(async ({ data }: any) => { attempts.set(data.stateHash, { codeCipher: null, denied: false, ...data }) }),
      findUnique: vi.fn(async ({ where }: any) => attempts.get(where.stateHash)),
      deleteMany: vi.fn(async ({ where }: any) => ({ count: where.stateHash ? Number(attempts.delete(where.stateHash)) : 0 })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const value = attempts.get(where.stateHash)
        if (!value || value.expiresAt <= new Date() || value.codeCipher || value.denied) return { count: 0 }
        Object.assign(value, data); return { count: 1 }
      }),
    },
    marketplaceAccount: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'account' })), update: vi.fn(async () => ({ id: 'account' })) },
    marketplaceCredential: { upsert: vi.fn() },
    $transaction: async (fn: any) => fn(db),
  }
  provider = vi.fn(async () => new Response(JSON.stringify(token())))
  app = Fastify(); await app.register(cookie)
  registerMagalu(app, db, async (req: any, reply: any) => {
    if (!req.cookies.session) return reply.code(401).send({ error: 'Login necessário' })
    req.currentUser = { id: 'user1' }
  }, 'session', origin, provider)
})
afterEach(async () => { await app.close(); vi.unstubAllEnvs() })
async function start() {
  const res = await app.inject({ method: 'POST', url: `/companies/${companyId}/integrations/magalu/authorize`, headers, payload: {} })
  const url = new URL(res.json().url)
  return { state: url.searchParams.get('state')!, url }
}
const callback = (state: string, extra = 'code=provider-secret') => app.inject(`/integrations/magalu/callback?state=${state}&${extra}`)
const complete = (state: string, extraHeaders = {}) => app.inject({ method: 'POST', url: '/integrations/magalu/complete', headers: { ...headers, ...extraHeaders }, payload: { state } })

describe('Magalu OAuth', () => {
  it('requires matching HTTPS callback, credentials and encryption key', async () => {
    for (const value of ['http://stage.example.test/integrations/magalu/callback', 'https://other.test/integrations/magalu/callback', `${origin}/wrong`, `${origin}/integrations/magalu/callback?extra=1`]) {
      vi.stubEnv('MAGALU_REDIRECT_URI', value)
      expect(() => magaluConfiguration(origin)).toThrow()
    }
    const response = await app.inject({ method: 'POST', url: `/companies/${companyId}/integrations/magalu/authorize`, headers })
    expect(response.statusCode).toBe(503); expect(attempts.size).toBe(0)
  })
  it('requires session, trusted origin, membership and write role', async () => {
    const url = `/companies/${companyId}/integrations/magalu/authorize`
    expect((await app.inject({ method: 'POST', url, headers: { origin } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://other.test' } })).statusCode).toBe(403)
    db.companyMember.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(404)
    db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(403)
    expect(attempts.size).toBe(0)
  })
  it('requests only order/delivery reading and selects the seller organization', async () => {
    const { state, url } = await start()
    expect(url.origin + url.pathname).toBe('https://id.magalu.com/login')
    expect(url.searchParams.get('choose_tenants')).toBe('true')
    expect(url.searchParams.get('scope')).toBe(MAGALU_SCOPES.join(' '))
    expect(url.searchParams.get('client_secret')).toBeNull()
    expect(state).toMatch(/^[a-f0-9]{64}$/)
    expect(attempts.has(digest(state))).toBe(true)
    expect(attempts.has(state)).toBe(false)
  })
  it('encrypts the code and tokens, binds the session and rejects replay', async () => {
    const { state } = await start()
    const result = await callback(state)
    expect(result.statusCode).toBe(302)
    expect(result.headers.location).toBe(`${origin}/#magalu_state=${state}`)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(crypt.open(attempts.get(digest(state)).codeCipher)).toBe('provider-secret')
    expect((await complete(state, { cookie: 'session=other' })).statusCode).toBe(400)
    expect(provider).not.toHaveBeenCalled()
    const completed = await complete(state)
    expect(completed.json()).toEqual({ connected: true, companyId })
    expect(completed.body).not.toContain('refresh-secret')
    const saved = db.marketplaceCredential.upsert.mock.calls[0][0].create
    const stored = JSON.parse(crypt.open(saved.tokenCipher))
    expect(stored.refreshToken).toBe('refresh-secret')
    expect(magaluTenant(stored.accessToken)).toBe(tenant)
    expect(saved.tokenCipher).not.toContain('refresh-secret')
    expect(db.marketplaceAccount.create.mock.calls[0][0].data).toMatchObject({ marketplace: 'MAGALU', externalId: tenant, companyId })
    const [endpoint, init] = provider.mock.calls[0]
    expect(endpoint).toBe('https://id.magalu.com/oauth/token')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body)).toMatchObject({ client_id: 'client-test', client_secret: 'secret-test', code: 'provider-secret', redirect_uri: `${origin}/integrations/magalu/callback` })
    expect((await complete(state)).statusCode).toBe(400)
    expect((await callback(state)).statusCode).toBe(400)
    expect(provider).toHaveBeenCalledTimes(1)
  })
  it('rejects incomplete, expired, unknown and ambiguous callbacks', async () => {
    expect((await app.inject('/integrations/magalu/callback')).statusCode).toBe(400)
    expect((await callback('a'.repeat(64))).statusCode).toBe(400)
    const { state } = await start()
    expect((await complete(state)).statusCode).toBe(400)
    expect((await callback(state, 'code=x&error=access_denied')).statusCode).toBe(400)
    attempts.get(digest(state)).expiresAt = new Date(0)
    expect((await callback(state)).statusCode).toBe(400)
    expect((await complete(state)).statusCode).toBe(400)
    expect(provider).not.toHaveBeenCalled()
  })
  it('handles cancellation without a token exchange', async () => {
    const { state } = await start(); await callback(state, 'error=access_denied')
    expect((await callback(state)).statusCode).toBe(400)
    expect((await complete(state)).json().error).toContain('cancelada')
    expect(provider).not.toHaveBeenCalled()
  })
  it('rechecks permissions before completion and inside the transaction', async () => {
    const { state } = await start(); await callback(state)
    db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    expect((await complete(state)).statusCode).toBe(403)
    expect(provider).not.toHaveBeenCalled()
    db.companyMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValue({ role: 'VIEWER' })
    expect((await complete(state)).statusCode).toBe(502)
    expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
  })
  it('isolates provider states and refuses shops assigned to another company', async () => {
    // A Mercado Livre state is absent from the dedicated Magalu attempts table.
    expect((await complete('b'.repeat(64))).statusCode).toBe(400)
    const { state } = await start(); await callback(state)
    db.marketplaceAccount.findUnique.mockResolvedValue({ id: 'account', companyId: 'other' })
    expect((await complete(state)).statusCode).toBe(502)
    expect(db.marketplaceAccount.update).not.toHaveBeenCalled()
    expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
  })
  it('reconnects the same shop without replacing its imported history', async () => {
    const { state } = await start(); await callback(state)
    db.marketplaceAccount.findUnique.mockResolvedValue({ id: 'account', companyId })
    expect((await complete(state)).statusCode).toBe(200)
    expect(db.marketplaceAccount.create).not.toHaveBeenCalled()
    expect(db.marketplaceAccount.update).toHaveBeenCalledWith({ where: { id: 'account' }, data: {
      status: 'CONNECTED', syncError: null, syncFailures: 0, nextSyncAt: expect.any(Date),
    } })
  })
  it.each(['missing-scope', 'invalid-jwt', 'provider-error', 'timeout'])('does not save tokens or expose secrets for %s', async failure => {
    const { state } = await start(); await callback(state)
    if (failure === 'missing-scope') provider.mockResolvedValue(new Response(JSON.stringify({ ...token(), scope: 'other' })))
    if (failure === 'invalid-jwt') provider.mockResolvedValue(new Response(JSON.stringify({ ...token(), access_token: 'invalid' })))
    if (failure === 'provider-error') provider.mockResolvedValue(new Response('provider-sensitive-details', { status: 400 }))
    if (failure === 'timeout') provider.mockRejectedValue(new Error('timeout-sensitive-details'))
    const response = await complete(state)
    expect(response.statusCode).toBe(502)
    expect(response.body).not.toMatch(/sensitive-details|secret-test|provider-secret|refresh-secret/)
    expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
  })
  it('only extracts a canonical tenant from a current provider token', () => {
    expect(magaluTenant(jwt())).toBe(tenant)
    expect(magaluTenant(jwt(tenant.toUpperCase()))).toBe(tenant)
    expect(() => magaluTenant(jwt('unknown'))).toThrow()
    expect(() => magaluTenant(jwt(tenant, 1))).toThrow()
  })
})
