import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { vault } from './mercadolivre.js'
import { SyncError } from './order-sync.js'
import type { SyncExecution } from './sync-contract.js'
import { shopeeEnvironment } from './shopee-environment.js'
export { shopeeEnvironment } from './shopee-environment.js'

// Shopee Authorization and Authentication, updated 2026-07-23.
// Fixed provider authorization/API hosts; credentials never select a host.
// JSON request bodies require numeric IDs. Reject precision loss and aliases.
const numericId = z.number().int().positive().safe()
const idString = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)))
export function shopeeConfiguration(origin: string) {
  const partnerId = idString.parse(process.env.SHOPEE_PARTNER_ID)
  const partnerKey = z.string().min(1).max(32768).parse(process.env.SHOPEE_PARTNER_KEY)
  const redirect = new URL(process.env.SHOPEE_REDIRECT_URI ?? '')
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash ||
      redirect.pathname !== '/integrations/shopee/callback' || redirect.origin !== new URL(origin).origin) throw new Error('Configuração Shopee inválida')
  return { ...shopeeEnvironment(), partnerId, partnerKey, redirect: redirect.href,
    crypt: vault(process.env.TOKEN_ENCRYPTION_KEY ?? '') }
}
type Configuration = ReturnType<typeof shopeeConfiguration>

export function shopeeAuthorizationUrl(config: Configuration, state: string) {
  z.string().regex(/^[a-f0-9]{64}$/).parse(state)
  const url = new URL(config.authorizationUrl)
  url.search = new URLSearchParams({ partner_id: config.partnerId, auth_type: 'seller',
    redirect_uri: config.redirect, response_type: 'code', state }).toString()
  return url.href
}

// Public APIs omit access_token/shop_id; Shop APIs append both in this order.
export function shopeeSignedUrl(config: Configuration, path: string,
  shop?: { accessToken: string; shopId: string }, timestamp = Math.floor(Date.now() / 1000)) {
  if (!/^\/api\/v2\/(?:[a-z_]+\/){1,2}[a-z_]+$/.test(path)) throw new Error('Caminho Shopee inválido')
  numericId.parse(timestamp)
  if (shop) { idString.parse(shop.shopId); z.string().min(1).max(32768).parse(shop.accessToken) }
  const base = `${config.partnerId}${path}${timestamp}${shop ? shop.accessToken + shop.shopId : ''}`
  const sign = createHmac('sha256', config.partnerKey).update(base, 'utf8').digest('hex')
  const host = config.environment === 'PRODUCTION' && path.startsWith('/api/v2/order/')
    ? 'https://openplatform.shopee.com.br' : config.baseUrl
  const url = new URL(path, host)
  url.search = new URLSearchParams({ partner_id: config.partnerId, timestamp: String(timestamp), sign,
    ...(shop ? { access_token: shop.accessToken, shop_id: shop.shopId } : {}) }).toString()
  return url
}

const tokenResponse = z.object({
  error: z.literal(''), access_token: z.string().min(1).max(32768), refresh_token: z.string().min(1).max(32768),
  expire_in: z.number().int().positive().max(86400),
  shop_id: numericId.optional(), partner_id: numericId.optional(),
})
export type ShopeeTokens = { accessToken: string; refreshToken: string; shopId: string; partnerId: string }

// Only fixed labels leave this function. Provider messages can echo credentials.
function tokenFailureDetail(body: unknown) {
  if (!body || typeof body !== 'object') return 'Resposta sem diagnóstico JSON.'
  const record = body as Record<string, unknown>
  const knownCodes = new Set(['error_auth', 'error_sign', 'error_param', 'error_permission', 'error_api_permission',
    'error_api_call_restricted', 'source_ip_undeclared', 'error_partner_key_expired', 'error_not_found',
    'error_code', 'error_invalid_code', 'error_expired_code', 'invalid_code', 'invalid_auth_code',
    'invalid_authorization_code', 'expired_code', 'wrong_code', 'error_ip', 'error_limit', 'error_rate_limit'])
  const code = typeof record.error === 'string' && knownCodes.has(record.error) ? record.error : 'não classificado'
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : ''
  const topics = [
    [/signature|\bsign\b/, 'assinatura'], [/\bip\b|whitelist/, 'IP'],
    [/permission|restricted|forbidden/, 'permissão'], [/\bcode\b/, 'código de autorização'],
    [/partner.?key/, 'chave do aplicativo'], [/timestamp|\btime\b/, 'horário'],
    [/expired|invalid|wrong|incorrect/, 'valor inválido ou expirado'],
  ] as const
  const mentions = topics.filter(([pattern]) => pattern.test(message)).map(([, label]) => label)
  return `Erro Shopee: ${code}.${mentions.length ? ` A mensagem menciona: ${mentions.join(', ')}.` : ''}`
}

async function requestTokens(config: Configuration, path: string, shopId: string, payload: Record<string, unknown>, request: typeof fetch) {
  idString.parse(shopId)
  // Token exchange and refresh are single-use operations. Never retry blindly.
  let response: Response
  try {
    response = await request(shopeeSignedUrl(config, path), { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ ...payload, partner_id: Number(config.partnerId), shop_id: Number(shopId) }) })
  } catch { throw new SyncError(502, 'Não foi possível confirmar a autorização Shopee. Inicie uma nova conexão se a falha persistir.') }
  if (response.status === 429) {
    const retry = response.headers.get('retry-after') ?? ''
    const retryMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0
    throw new SyncError(429, 'A Shopee limitou as consultas. Aguarde antes de tentar novamente.', false, undefined, retryMs)
  }
  // Never pass provider messages, fetch errors or Zod token payloads to logs/UI.
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new SyncError(502, `A Shopee recusou a solicitação (HTTP ${response.status}). ${tokenFailureDetail(body)}`)
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error !== '') {
    throw new SyncError(502, `A Shopee retornou uma recusa de autorização. ${tokenFailureDetail(body)}`)
  }
  const parsed = tokenResponse.safeParse(body)
  if (!parsed.success) throw new SyncError(502, 'A resposta de autorização da Shopee não contém os campos no formato esperado pelo OmniMark.')
  const token = parsed.data
  if ((token.shop_id !== undefined && String(token.shop_id) !== shopId) ||
      (token.partner_id !== undefined && String(token.partner_id) !== config.partnerId) ||
      (path.endsWith('/access_token/get') && (token.shop_id === undefined || token.partner_id === undefined))) {
    throw new SyncError(409, 'A autorização Shopee não corresponde à loja ou ao aplicativo. Reconecte a loja.', true)
  }
  return { tokens: { accessToken: token.access_token, refreshToken: token.refresh_token, shopId, partnerId: config.partnerId },
    expiresAt: new Date(Date.now() + token.expire_in * 1000) }
}

export async function exchangeShopeeCode(config: Configuration, code: string, shopId: string, request: typeof fetch = fetch) {
  z.string().min(1).max(8192).parse(code)
  return requestTokens(config, '/api/v2/auth/token/get', shopId, { code }, request)
}

export async function refreshShopeeTokens(config: Configuration, tokens: ShopeeTokens, request: typeof fetch = fetch) {
  if (tokens.partnerId !== config.partnerId) throw new SyncError(409, 'O aplicativo Shopee mudou. Reconecte a loja.', true)
  z.string().min(1).max(32768).parse(tokens.refreshToken)
  return requestTokens(config, '/api/v2/auth/access_token/get', tokens.shopId, { refresh_token: tokens.refreshToken }, request)
}

// Called by the order adapter while it owns the scheduler lease.
// Persist rotated tokens immediately, even if order import later fails.
export async function refreshShopeeCredential(db: PrismaClient, accountId: string, config: Configuration,
  execution: SyncExecution, request: typeof fetch = fetch) {
  const account = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId }, include: { credentials: true } })
  if (account.marketplace !== 'SHOPEE' || account.environment !== config.environment || account.syncLock !== execution.lease ||
      !account.syncLockUntil || account.syncLockUntil <= new Date()) throw new SyncError(409, 'A renovação Shopee perdeu sua reserva ou pertence a outro ambiente.')
  if (!account.credentials) throw new SyncError(409, 'Reconecte a loja Shopee.', true)
  let stored: ShopeeTokens
  try {
    stored = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), shopId: idString, partnerId: idString })
      .parse(JSON.parse(config.crypt.open(account.credentials.tokenCipher)))
  } catch { throw new SyncError(409, 'As credenciais Shopee precisam ser renovadas por uma nova conexão.', true) }
  if (stored.shopId !== account.externalId || stored.partnerId !== config.partnerId) throw new SyncError(409, 'A autorização Shopee não corresponde à loja ou ao aplicativo.', true)
  const result = await refreshShopeeTokens(config, stored, request)
  const tokenCipher = config.crypt.seal(JSON.stringify(result.tokens))
  const saved = await db.marketplaceCredential.updateMany({ where: { accountId, tokenCipher: account.credentials.tokenCipher,
    account: { syncLock: execution.lease, syncLockUntil: { gt: new Date() }, environment: config.environment, marketplace: 'SHOPEE' } },
    data: { tokenCipher, expiresAt: result.expiresAt } })
  if (saved.count !== 1) throw new SyncError(409, 'A autorização Shopee foi alterada durante a renovação. Inicie uma nova conexão se necessário.')
  return result
}
