import { z } from 'zod'

export function shopeeEnvironment() {
  const name = z.enum(['sandbox', 'production']).default('sandbox').parse(process.env.SHOPEE_ENVIRONMENT)
  return name === 'sandbox'
    // The BR sandbox hostname listed in the guide does not resolve. Use the
    // documented global sandbox entry point (DNS/HTTPS verified 2026-10-27).
    ? { environment: 'SANDBOX' as const, authorizationUrl: 'https://open.sandbox.test-stable.shopee.com/auth',
      baseUrl: 'https://openplatform.sandbox.test-stable.shopee.sg' }
    : { environment: 'PRODUCTION' as const, authorizationUrl: 'https://open.shopee.com.br/auth',
      baseUrl: 'https://partner.shopeemobile.com' }
}
