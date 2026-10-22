import type { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { vault } from './mercadolivre.js'
import { magaluTenant, MAGALU_SCOPES } from './magalu.js'
import { SyncError } from './order-sync.js'
import type { SyncExecution } from './sync-contract.js'

const diagnosticFields = new Set(['status', 'purchased_at__gte', 'purchased_at__lte', 'updated_at__gte', 'updated_at__lte', 'code', '_limit', '_offset', '_sort'])
const validationError = z.object({ detail: z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])) })) })
const oauthError = z.object({ error: z.enum(['invalid_grant', 'invalid_client', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope']) })
function magaluDiagnostic(response: Response, operation: 'orders.list' | 'oauth.refresh', payload: unknown) {
  const validation = validationError.safeParse(payload)
  const fields = validation.success ? [...new Set(validation.data.detail.flatMap(issue => issue.loc
    .filter((part): part is string => typeof part === 'string').flatMap(part => part.split(',')).filter(part => diagnosticFields.has(part))))].sort() : []
  const oauth = operation === 'oauth.refresh' ? oauthError.safeParse(payload) : null
  // Allowlisted metadata only: never copy messages, inputs, tokens, URLs or buyer data.
  return { reference: randomUUID(), operation: `magalu.${operation}`, providerStatus: response.status,
    detail: fields.length ? `Campos rejeitados: ${fields.join(', ')}.` : oauth?.success ? `OAuth: ${oauth.data.error}.` : 'Resposta recusada pela API Magalu.' }
}

const integer = z.number().int().nonnegative().safe()
const amount = z.object({ currency: z.literal('BRL'), normalizer: z.number().int().positive().safe(), total: integer })
const remoteOrder = z.object({
  code: z.string().min(1).max(256),
  purchased_at: z.string().datetime({ offset: true }).nullish(), created_at: z.string().datetime({ offset: true }).nullish(),
  approved_at: z.string().datetime({ offset: true }).nullish(),
  status: z.enum(['new', 'approved', 'cancelled', 'finished']),
  amounts: amount.extend({ freight: amount.nullish() }),
  deliveries: z.array(z.object({
    id: z.string().min(1), seller: z.object({ id: z.string().min(1) }),
    status: z.enum(['new', 'approved', 'invoiced', 'shipped', 'delivered', 'cancelled', 'frozen']),
    items: z.array(z.object({
      quantity: z.number().int().positive(), info: z.object({ name: z.string().min(1).max(1000) }),
      unit_price: z.object({ currency: z.literal('BRL'), normalizer: z.number().int().positive().safe(), value: integer }),
    })).min(1),
  })).min(1),
})
const real = (value: number, normalizer: number) => Math.round(value / normalizer * 100) / 100
export function normalizeMagaluOrder(raw: unknown, tenant: string) {
  const order = remoteOrder.parse(raw)
  if (!order.deliveries.every(delivery => delivery.seller.id.replace(/^GENPUB\./, '').toLowerCase() === tenant)) throw new SyncError(502, 'O Magalu retornou um pedido de outra loja.')
  const date = order.purchased_at ?? order.created_at
  if (!date) throw new SyncError(502, 'O Magalu retornou um pedido sem data de compra.')
  const total = real(order.amounts.total, order.amounts.normalizer)
  const freight = order.amounts.freight
  const shipping = freight ? real(freight.total, freight.normalizer) : 0
  if (freight && shipping > total) throw new SyncError(502, 'Os valores do pedido Magalu são inconsistentes.')
  const paymentConfirmed = !!order.approved_at || ['approved', 'finished'].includes(order.status)
  const active = order.deliveries.filter(delivery => delivery.status !== 'cancelled')
  const status = order.status === 'cancelled' ? 'cancelled' : active.length && active.every(delivery => delivery.status === 'delivered') ? 'delivered'
    : active.some(delivery => ['shipped', 'delivered'].includes(delivery.status)) ? 'shipped' : paymentConfirmed ? 'paid' : 'pending'
  return {
    id: order.code, marketplace: 'magalu', date, status,
    items: order.deliveries.flatMap(delivery => delivery.items.map(item => ({ name: item.info.name, qty: item.quantity, unitPrice: real(item.unit_price.value, item.unit_price.normalizer) }))),
    shipping, shippingKnown: !!freight,
    // Order total is authoritative and already includes discounts and freight.
    // Returns/refunds require their own reconciliation; absence is not a known zero.
    financials: { productsTotal: Math.round((total - shipping) * 100) / 100, discount: 0, paymentConfirmed,
      refundsKnown: false, returnsKnown: false, refunds: [], returns: [] },
  }
}

const pageSchema = z.object({ results: z.array(z.unknown()), meta: z.object({
  page: z.object({ count: integer, offset: integer, limit: z.number().int().positive().max(100) }),
  links: z.object({ next: z.string().nullish() }),
}) })
export async function readMagaluOrders(get: (path: string) => Promise<unknown>, from: Date, to: Date, incremental: boolean) {
  const records = new Map<string, unknown>()
  let offset = 0
  for (let pageIndex = 0; pageIndex <= 200; pageIndex++) {
    const field = incremental ? 'updated_at' : 'purchased_at'
    const query = new URLSearchParams({ [`${field}__gte`]: from.toISOString(), [`${field}__lte`]: to.toISOString(), _limit: '50', _offset: String(offset), _sort: 'purchased_at:asc' })
    const page = pageSchema.parse(await get(`/seller/v1/orders?${query}`))
    if (page.meta.page.offset !== offset || page.meta.page.count !== page.results.length) throw new SyncError(502, 'O Magalu retornou uma página inconsistente. Os dados anteriores foram preservados.')
    for (const raw of page.results) {
      const order = remoteOrder.parse(raw)
      if (records.has(order.code)) throw new SyncError(409, 'Os pedidos Magalu mudaram durante a consulta. A atualização será repetida automaticamente.')
      records.set(order.code, raw)
      if (records.size > 10000) throw new SyncError(422, 'O histórico Magalu excede o limite desta importação.')
    }
    const next = page.meta.links.next
    if (!next) return [...records.values()]
    const url = new URL(next, 'https://api.magalu.com/seller/v1/orders')
    const nextOffset = Number(url.searchParams.get('_offset'))
    if (!page.results.length || url.origin !== 'https://api.magalu.com' || url.pathname !== '/seller/v1/orders' || !Number.isSafeInteger(nextOffset) || nextOffset !== offset + page.results.length) throw new SyncError(502, 'O Magalu retornou uma paginação inválida. Nenhum resultado parcial foi publicado.')
    offset = nextOffset
  }
  throw new SyncError(422, 'A paginação Magalu excedeu o limite desta importação.')
}

const tokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().max(86400), token_type: z.string().refine(value => value.toLowerCase() === 'bearer'), scope: z.string().optional() })
export async function syncMagaluAccount(db: PrismaClient, accountId: string, request: typeof fetch, execution: SyncExecution) {
  const account = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId }, include: { credentials: true } })
  if (account.marketplace !== 'MAGALU' || account.syncLock !== execution.lease) throw new SyncError(409, 'A sincronização perdeu sua reserva.')
  if (!account.credentials) throw new SyncError(409, 'Reconecte sua loja Magalu.', true)
  const crypt = vault(process.env.TOKEN_ENCRYPTION_KEY ?? '')
  let tokens = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1) }).parse(JSON.parse(crypt.open(account.credentials.tokenCipher)))
  let credentialCipher = account.credentials.tokenCipher
  const deadline = Date.now() + 10 * 60_000
  async function refresh() {
    if (!process.env.MAGALU_CLIENT_ID || !process.env.MAGALU_CLIENT_SECRET) throw new SyncError(503, 'As credenciais da aplicação Magalu não estão configuradas.')
    const response = await request('https://id.magalu.com/oauth/token', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token',
        client_id: process.env.MAGALU_CLIENT_ID, client_secret: process.env.MAGALU_CLIENT_SECRET, refresh_token: tokens.refreshToken }), signal: AbortSignal.timeout(20000) })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const revoked = body?.error === 'invalid_grant'
      throw new SyncError(revoked ? 409 : 502, revoked ? 'A autorização Magalu expirou ou foi revogada. Reconecte sua loja.' : 'Não foi possível renovar a autorização Magalu. Uma nova tentativa será feita automaticamente.', revoked, magaluDiagnostic(response, 'oauth.refresh', body))
    }
    const result = tokenResponse.parse(await response.json())
    if (magaluTenant(result.access_token) !== account.externalId || (result.scope !== undefined && !MAGALU_SCOPES.every(scope => result.scope!.split(/\s+/).includes(scope)))) throw new SyncError(409, 'A autorização Magalu não corresponde à loja ou às permissões necessárias. Reconecte a loja.', true)
    tokens = { accessToken: result.access_token, refreshToken: result.refresh_token }
    const cipher = crypt.seal(JSON.stringify(tokens))
    const saved = await db.marketplaceCredential.updateMany({ where: { accountId, tokenCipher: credentialCipher, account: { syncLock: execution.lease } },
      data: { tokenCipher: cipher, expiresAt: new Date(Date.now() + result.expires_in * 1000) } })
    if (!saved.count) throw new SyncError(409, 'A autorização Magalu foi alterada durante a sincronização.')
    credentialCipher = cipher
  }
  if (account.credentials.expiresAt.getTime() <= Date.now() + 30000) await refresh()
  if (magaluTenant(tokens.accessToken) !== account.externalId) throw new SyncError(409, 'A autorização Magalu não corresponde à loja.', true)
  async function get(path: string): Promise<unknown> {
    let refreshed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline) throw new SyncError(504, 'A atualização Magalu excedeu o tempo limite e será repetida automaticamente.')
      const response = await request(`https://api.magalu.com${path}`, { redirect: 'error', headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(20000) })
      if (response.status === 401 && !refreshed) { await refresh(); refreshed = true; continue }
      if (response.status === 429) {
        const value = response.headers.get('retry-after') ?? ''
        const retryMs = /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0
        throw new SyncError(429, 'O Magalu limitou as consultas. A atualização será repetida automaticamente.', false, magaluDiagnostic(response, 'orders.list', null), retryMs)
      }
      if (response.status >= 500 && attempt < 2) { await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000)); continue }
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new SyncError(response.status === 401 || response.status === 403 ? 409 : 502,
          response.status === 403 ? 'O Magalu recusou acesso aos pedidos. Reconecte a loja e autorize a leitura dos pedidos e entregas.' : 'Não foi possível consultar os pedidos Magalu. A atualização será repetida automaticamente.', response.status === 401 || response.status === 403,
          magaluDiagnostic(response, 'orders.list', body))
      }
      return response.json()
    }
    throw new SyncError(502, 'Não foi possível atualizar os pedidos Magalu.')
  }
  const to = new Date(), historyStart = new Date(to)
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 1)
  const fullSync = !account.lastFullSyncAt || !account.syncTo || Date.now() - account.lastFullSyncAt.getTime() >= 86400_000
  const from = fullSync ? historyStart : new Date(Math.max(historyStart.getTime(), account.syncTo!.getTime() - 15 * 60_000))
  const remote = await readMagaluOrders(get, from, to, !fullSync)
  const normalized = remote.map(order => normalizeMagaluOrder(order, account.externalId))
  const completedAt = new Date()
  await db.$transaction(async tx => {
    const owned = await tx.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: execution.lease, syncLockUntil: { gt: new Date() } }, data: {
      lastSyncAt: completedAt, syncFrom: fullSync ? from : account.syncFrom ?? historyStart, syncTo: to,
      ...(fullSync ? { lastFullSyncAt: completedAt } : {}), syncError: null, status: 'CONNECTED',
    } })
    if (!owned.count) throw new SyncError(409, 'A sincronização Magalu perdeu sua reserva.')
    for (const snapshot of normalized) {
      const saved = await tx.order.upsert({ where: { accountId_externalId: { accountId, externalId: snapshot.id } },
        create: { accountId, externalId: snapshot.id, status: snapshot.status, currency: 'BRL', orderedAt: new Date(snapshot.date), grossAmount: snapshot.financials.productsTotal + snapshot.shipping, snapshot: snapshot as Prisma.InputJsonValue },
        update: { status: snapshot.status, orderedAt: new Date(snapshot.date), grossAmount: snapshot.financials.productsTotal + snapshot.shipping, snapshot: snapshot as Prisma.InputJsonValue } })
      await tx.orderItem.deleteMany({ where: { orderId: saved.id } })
      await tx.orderItem.createMany({ data: snapshot.items.map(item => ({ orderId: saved.id, title: item.name, quantity: item.qty, unitPrice: item.unitPrice })) })
    }
  }, { timeout: 60000 })
  return { orders: normalized.length, incomplete: normalized.length }
}
