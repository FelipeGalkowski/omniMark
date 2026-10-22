import { afterEach, expect, it, vi } from 'vitest'
import { activeMarketplaceAccounts, magaluAccountContext, magaluEnvironment, magaluRequestHeaders, MAGALU_SANDBOX_CHANNEL } from './magalu-environment.js'
afterEach(() => vi.unstubAllEnvs())
const tenant = '351d49cf-9394-4b20-8ced-be7e16d65fa5'
it('defaults existing accounts to production and refuses unknown API environments', () => {
  vi.stubEnv('MAGALU_ENVIRONMENT', 'production')
  expect(magaluAccountContext({ externalId: tenant }).baseUrl).toBe('https://api.magalu.com')
  vi.stubEnv('MAGALU_ENVIRONMENT', 'https://attacker.example')
  expect(magaluEnvironment).toThrow()
})
it('requires the sandbox onboarding seller/channel and binds request headers to that seller', () => {
  vi.stubEnv('MAGALU_ENVIRONMENT', 'sandbox')
  expect(() => magaluAccountContext({ environment: 'PRODUCTION', externalId: tenant })).toThrow('MISMATCH')
  expect(() => magaluAccountContext({ environment: 'SANDBOX', externalId: tenant })).toThrow()
  const seller = '9e0dcdef-a9ad-40f7-a739-266de26b78bc'
  const context = magaluAccountContext({ environment: 'SANDBOX', externalId: tenant, magaluSellerId: seller, magaluChannelId: MAGALU_SANDBOX_CHANNEL })
  expect(context.baseUrl).toBe('https://api-sandbox.magalu.com')
  expect(magaluRequestHeaders('fixture-token', context)).toMatchObject({ 'X-Tenant-Id': `GENPUB.${seller}`, 'X-Channel-Id': MAGALU_SANDBOX_CHANNEL })
  expect(activeMarketplaceAccounts()).toEqual({ OR: [{ marketplace: { not: 'MAGALU' } }, { marketplace: 'MAGALU', environment: 'SANDBOX' }] })
})
