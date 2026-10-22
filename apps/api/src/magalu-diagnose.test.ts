import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { diagnoseMagalu } from './magalu-diagnose.js'
import { vault } from './mercadolivre.js'

const tenant = 'c36f9d61-241d-43c6-87ed-2faac6dc8ab1', key = 'ab'.repeat(32)
function database() {
  const token = `header.${Buffer.from(JSON.stringify({ sub: `GENPUB.${tenant}`, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url')}.signature`
  const account = { externalId: tenant, lastFullSyncAt: null, syncTo: null,
    credentials: { tokenCipher: vault(key).seal(JSON.stringify({ accessToken: token, refreshToken: 'private-refresh' })), expiresAt: new Date(Date.now() + 7200000) } }
  return { db: { marketplaceAccount: { findMany: vi.fn(async () => [account]) } } as any, account }
}
beforeEach(() => { vi.stubEnv('WEB_ORIGIN', 'https://teste.omnimark.tech'); vi.stubEnv('TOKEN_ENCRYPTION_KEY', key) })
afterEach(() => vi.unstubAllEnvs())

it('makes exactly one read-only request and returns only safe diagnostics', async () => {
  const { db } = database()
  const request = vi.fn(async () => new Response(JSON.stringify({ slug: 'UNPROCESSABLE_ENTITY', details: [{ field: '_limit', slug: 'INVALID_PARAMETER_VALUE', message: 'private-refresh customer@example.test' }] }), { status: 422 }))
  const result = await diagnoseMagalu(db, request)
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0]).toEqual([expect.stringContaining('https://api.magalu.com/seller/v1/orders?'), expect.objectContaining({ redirect: 'error' })])
  expect(result).toMatchObject({ providerStatus: 422, detail: 'Campos rejeitados: _limit. Regras: INVALID_PARAMETER_VALUE, UNPROCESSABLE_ENTITY.' })
  expect(JSON.stringify(result)).not.toMatch(/private|customer|header\./)
})
it('refuses other environments before reading any account', async () => {
  const { db } = database(), request = vi.fn()
  vi.stubEnv('WEB_ORIGIN', 'https://omnimark.tech')
  await expect(diagnoseMagalu(db, request)).rejects.toThrow('stage')
  expect(db.marketplaceAccount.findMany).not.toHaveBeenCalled()
  expect(request).not.toHaveBeenCalled()
})
it('does not rotate an expired token or guess which account to inspect', async () => {
  const { db, account } = database(), request = vi.fn()
  account.credentials.expiresAt = new Date(0)
  await expect(diagnoseMagalu(db, request)).rejects.toThrow('renovação automática')
  db.marketplaceAccount.findMany.mockResolvedValue([account, account])
  await expect(diagnoseMagalu(db, request)).rejects.toThrow('exatamente uma conta')
  expect(request).not.toHaveBeenCalled()
})
it('discards successful response data instead of exposing orders or importing them', async () => {
  const { db } = database()
  const result = await diagnoseMagalu(db, vi.fn(async () => new Response(JSON.stringify({ results: [{ customer: 'private customer' }] }), { status: 200 })))
  expect(result.providerStatus).toBe(200)
  expect(JSON.stringify(result)).not.toContain('private')
})
