import { z } from 'zod'
import type { Prisma } from '@prisma/client'

export const MAGALU_READ_SCOPES = ['open:order-order-seller:read', 'open:order-delivery-seller:read']
export const MAGALU_SANDBOX_SCOPES = [...MAGALU_READ_SCOPES, 'open:order-logistics-seller:read',
  'open:portfolio-skus-seller:read', 'open:portfolio-skus-seller:write',
  'open:portfolio-prices-seller:read', 'open:portfolio-prices-seller:write',
  'open:portfolio-stocks-seller:read', 'open:portfolio-stocks-seller:write']
export const MAGALU_SANDBOX_CHANNEL = '5f62650a-0039-4d65-9b96-266d498c03bd'

export function magaluEnvironment() {
  const name = z.enum(['production', 'sandbox']).default('production').parse(process.env.MAGALU_ENVIRONMENT)
  return name === 'sandbox'
    ? { environment: 'SANDBOX' as const, baseUrl: 'https://api-sandbox.magalu.com', channelId: MAGALU_SANDBOX_CHANNEL, scopes: MAGALU_SANDBOX_SCOPES }
    : { environment: 'PRODUCTION' as const, baseUrl: 'https://api.magalu.com', channelId: null, scopes: MAGALU_READ_SCOPES }
}

export function magaluAccountContext(account: { environment?: 'PRODUCTION' | 'SANDBOX'; externalId: string; magaluSellerId?: string | null; magaluChannelId?: string | null }) {
  const config = magaluEnvironment()
  if ((account.environment ?? 'PRODUCTION') !== config.environment) throw new Error('MAGALU_ENVIRONMENT_MISMATCH')
  const sellerId = z.string().uuid().parse(account.magaluSellerId ?? (config.environment === 'PRODUCTION' ? account.externalId : undefined)).toLowerCase()
  if (config.environment === 'SANDBOX' && account.magaluChannelId !== config.channelId) throw new Error('MAGALU_SANDBOX_SETUP_REQUIRED')
  return { ...config, sellerId }
}

export function magaluRequestHeaders(accessToken: string, context: ReturnType<typeof magaluAccountContext>): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'X-Tenant-Id': `GENPUB.${context.sellerId}`,
    ...(context.channelId ? { 'X-Channel-Id': context.channelId } : {}) }
}

export function activeMarketplaceAccounts(): Prisma.MarketplaceAccountWhereInput {
  return { OR: [{ marketplace: { not: 'MAGALU' } }, { marketplace: 'MAGALU', environment: magaluEnvironment().environment }] }
}
