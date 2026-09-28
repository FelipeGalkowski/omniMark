import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { configuration, digest, registerMercadoLivre, vault } from './mercadolivre.js'

const companyId = '2a741c2f-c591-41c3-9bc3-92db19003e1d'
const origin = 'http://localhost:5173'
const key = 'ab'.repeat(32)
const crypt = vault(key)
let app: ReturnType<typeof Fastify>
let db: any
let provider: any
let attempts: Map<string, any>
beforeEach(async () => {
  vi.stubEnv('ML_CLIENT_ID', '12345'); vi.stubEnv('SECRET_KEY_ML', 'test-secret')
  vi.stubEnv('ML_REDIRECT_URI', 'https://example.test/integrations/mercadolivre/callback'); vi.stubEnv('TOKEN_ENCRYPTION_KEY', key)
  attempts = new Map()
  db = {
    companyMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    oAuthAttempt: {
      create: vi.fn(async ({ data }: any) => { attempts.set(data.stateHash, { codeCipher: null, denied: false, ...data }) }),
      findUnique: vi.fn(async ({ where }: any) => attempts.get(where.stateHash)),
      deleteMany: vi.fn(async ({ where }: any) => ({ count: where.stateHash ? Number(attempts.delete(where.stateHash)) : 0 })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const a = attempts.get(where.stateHash)
        if (!a || a.codeCipher || a.denied || a.expiresAt < new Date()) return { count: 0 }
        Object.assign(a, data); return { count: 1 }
      }),
    },
    marketplaceAccount: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'account1' })), update: vi.fn(async () => ({ id: 'account1' })) },
    marketplaceCredential: { upsert: vi.fn() },
    $transaction: async (fn: any) => fn(db),
  }
  provider = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', user_id: 42, expires_in: 21600 }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, nickname: 'Loja' })))
  app = Fastify(); await app.register(cookie)
  registerMercadoLivre(app, db, async (req: any, reply: any) => {
    if (!req.cookies.session) return reply.code(401).send({ error: 'Login necessário' })
    req.currentUser = { id: 'user1' }
  }, 'session', origin, provider)
})
afterEach(async () => { await app.close(); vi.unstubAllEnvs() })
const headers = { origin, cookie: 'session=original' }
async function start() {
  const res = await app.inject({ method: 'POST', url: `/companies/${companyId}/integrations/mercadolivre/authorize`, headers, payload: {} })
  const url = new URL(res.json().url)
  return { state: url.searchParams.get('state')!, url }
}
async function callback(state: string, extra = 'code=provider-code') {
  return app.inject(`/integrations/mercadolivre/callback?state=${state}&${extra}`)
}
async function complete(state: string, cookie = headers.cookie) {
  return app.inject({ method: 'POST', url: '/integrations/mercadolivre/complete', headers: { ...headers, cookie }, payload: { state } })
}
describe('Mercado Livre OAuth', () => {
  it('encrypts tokens and rejects tampering', () => {
    const cipher = crypt.seal('secret')
    expect(cipher).not.toContain('secret'); expect(crypt.open(cipher)).toBe('secret')
    const bytes = Buffer.from(cipher, 'base64'); bytes[30] ^= 1
    expect(() => crypt.open(bytes.toString('base64'))).toThrow()
  })
  it('requires HTTPS and valid encryption key', () => {
    vi.stubEnv('ML_REDIRECT_URI', 'http://example.test/integrations/mercadolivre/callback')
    expect(configuration).toThrow(); expect(() => vault('bad')).toThrow()
  })
  it('requires session, trusted origin and admin role', async () => {
    const url = `/companies/${companyId}/integrations/mercadolivre/authorize`
    expect((await app.inject({ method: 'POST', url, headers: { origin }, payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://attacker.test' }, payload: {} })).statusCode).toBe(403)
    db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(403)
    expect(attempts.size).toBe(0)
  })
  it('uses PKCE, binds session, stores encrypted credentials and rejects replay', async () => {
    const { state, url } = await start()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const attempt = attempts.get(digest(state))
    expect(attempt.verifierCipher).not.toBe(crypt.open(attempt.verifierCipher))
    const result = await callback(state)
    expect(result.statusCode).toBe(302); expect(result.headers.location).toBe(`${origin}/#ml_state=${state}`)
    expect(result.headers.location).not.toContain('provider-code')
    expect((await complete(state, 'session=other')).statusCode).toBe(400)
    expect((await complete(state)).json()).toEqual({ connected: true, companyId })
    const saved = db.marketplaceCredential.upsert.mock.calls[0][0].create
    expect(JSON.parse(crypt.open(saved.tokenCipher))).toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    const form = provider.mock.calls[0][1].body
    expect(form.get('code_verifier')).toBe(crypt.open(attempt.verifierCipher))
    expect(form.get('code')).toBe('provider-code')
    expect((await complete(state)).statusCode).toBe(400)
    expect(provider).toHaveBeenCalledTimes(2)
  })
  it('rejects expired state and a repeated callback', async () => {
    const { state } = await start(); attempts.get(digest(state)).expiresAt = new Date(0)
    expect((await callback(state)).statusCode).toBe(400)
    const next = await start(); await callback(next.state)
    expect((await callback(next.state)).statusCode).toBe(400)
    expect(provider).not.toHaveBeenCalled()
  })
  it('handles cancellation without exchanging tokens', async () => {
    const { state } = await start(); await callback(state, 'error=access_denied')
    expect((await complete(state)).json().error).toContain('cancelada')
    expect(provider).not.toHaveBeenCalled()
  })
  it('checks permission again at completion', async () => {
    const { state } = await start(); await callback(state)
    db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    expect((await complete(state)).statusCode).toBe(403)
    expect(provider).not.toHaveBeenCalled()
  })
  it('does not move an account belonging to another company', async () => {
    const { state } = await start(); await callback(state)
    db.marketplaceAccount.findUnique.mockResolvedValue({ id: 'account1', companyId: 'other' })
    expect((await complete(state)).statusCode).toBe(502)
    expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
    expect(db.marketplaceAccount.update).not.toHaveBeenCalled()
  })
  it('does not expose provider failures or save partial tokens', async () => {
    const { state } = await start(); await callback(state)
    provider.mockReset().mockResolvedValue(new Response('sensitive-response', { status: 400 }))
    const result = await complete(state)
    expect(result.statusCode).toBe(502); expect(result.body).not.toContain('sensitive-response')
    expect(db.marketplaceCredential.upsert).not.toHaveBeenCalled()
  })
})
