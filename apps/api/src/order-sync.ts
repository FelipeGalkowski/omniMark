import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient, Prisma } from '@prisma/client'
import { z } from 'zod'
import { vault } from './mercadolivre.js'

const identifier = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/)]).transform(String)
const money = z.number().finite().nonnegative()
const orderSchema = z.object({
  id: identifier, seller: z.object({ id: identifier }), currency_id: z.literal('BRL'),
  date_created: z.string().datetime({ offset: true }), status: z.string(), total_amount: money,
  order_items: z.array(z.object({ item: z.object({ title: z.string() }), quantity: z.number().int().positive(), unit_price: money })).min(1),
  payments: z.array(z.object({ id: identifier, status: z.string(), date_approved: z.string().nullable().optional(), transaction_amount_refunded: money.nullable().optional(), date_last_modified: z.string().optional() })),
  shipping: z.object({ id: identifier.nullable() }).nullable().optional(),
  tags: z.array(z.string()).optional(),
})
type RemoteOrder = z.infer<typeof orderSchema>
type OrderReturn = { id: string; status: 'requested' | 'in_progress' | 'completed' | 'cancelled' }
export class SyncError extends Error {
  constructor(public code: number, message: string, public reconnect = false, public diagnostic?: { reference: string; operation: string; providerStatus: number; detail: string }) { super(message) }
}

export function providerFailureDetail(payload: unknown, secrets: string[]): string {
  const body = z.object({ error: z.unknown().optional(), message: z.unknown().optional(), cause: z.unknown().optional() }).safeParse(payload)
  if (!body.success) return 'Resposta sem detalhe de erro legível.'
  const fields: string[] = []
  const collect = (value: unknown) => { if (typeof value === 'string') fields.push(value) }
  collect(body.data.error); collect(body.data.message)
  if (Array.isArray(body.data.cause)) for (const cause of body.data.cause.slice(0, 3)) {
    if (typeof cause === 'string') collect(cause)
    else if (cause && typeof cause === 'object') { collect(cause.code); collect(cause.message) }
  }
  let detail = fields.join(' | ')
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) detail = detail.split(secret).join('[redacted]')
  return detail
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:APP_USR|TEST)-[^\s,;"']+/g, '[token]')
    .replace(/\b\d{6,}\b/g, '[id]')
    .replace(/[\r\n\t]/g, ' ').slice(0, 600) || 'Resposta sem detalhe de erro legível.'
}

export function normalizeOrder(raw: unknown, sellerId: string, shipping: number | null, shipmentStatus?: string) {
  const order = orderSchema.parse(raw)
  if (order.seller.id !== sellerId) throw new SyncError(502, 'A API retornou um pedido de outro vendedor.')
  const payments = [...new Map(order.payments.map(p => [p.id, p])).values()]
  const approved = payments.filter(p => !!p.date_approved || ['approved', 'refunded', 'charged_back'].includes(p.status))
  const paymentConfirmed = approved.length > 0
  const refundsKnown = approved.every(p => p.transaction_amount_refunded !== undefined && p.transaction_amount_refunded !== null && p.status !== 'charged_back')
  const status = order.status === 'cancelled' ? 'cancelled' : shipmentStatus === 'delivered' ? 'delivered' : ['shipped', 'out_for_delivery'].includes(shipmentStatus ?? '') ? 'shipped' : paymentConfirmed ? 'paid' : 'pending'
  return {
    id: order.id, marketplace: 'mercadolivre', date: order.date_created, status,
    items: order.order_items.map(i => ({ name: i.item.title, qty: i.quantity, unitPrice: i.unit_price })),
    shipping: shipping ?? 0,
    shippingKnown: shipping !== null,
    financials: {
      paymentConfirmed, discount: 0, productsTotal: order.total_amount,
      refundsKnown, returnsKnown: false,
      refunds: approved.filter(p => (p.transaction_amount_refunded ?? 0) > 0).map(p => ({ id: `payment-${p.id}`, amount: p.transaction_amount_refunded!, status: 'confirmed', date: p.date_last_modified ?? order.date_created })),
      returns: [] as OrderReturn[],
    },
  }
}

export async function readReturns(get: (path: string) => Promise<unknown>, orderId: string, sellerId: string): Promise<OrderReturn[]> {
  const claims = new Set<string>()
  const returns = new Map<string, OrderReturn>()
  let offset = 0
  let expected: number | undefined
  while (true) {
    if (offset + 30 >= 10000) throw new Error('Limite de reclamações excedido.')
    const params = new URLSearchParams({ order_id: orderId, limit: '30', offset: String(offset) })
    const page = z.object({ paging: z.object({ total: z.number().int().nonnegative() }), data: z.array(z.object({
      id: identifier, type: z.string(), related_entities: z.array(z.string()),
      players: z.array(z.object({ type: z.string(), user_id: identifier })),
    })) }).parse(await get(`/post-purchase/v1/claims/search?${params}`))
    if (expected !== undefined && expected !== page.paging.total) throw new Error('Reclamações alteradas durante a consulta.')
    expected = page.paging.total
    for (const claim of page.data) {
      if (claims.has(claim.id) || !claim.players.some(player => player.type === 'seller' && player.user_id === sellerId)) throw new Error('Reclamação inconsistente.')
      claims.add(claim.id)
      if (!claim.related_entities.includes('return') && claim.type !== 'return') continue
      const result = z.object({ id: identifier, status: z.string() }).parse(await get(`/post-purchase/v2/claims/${claim.id}/returns`))
      const statuses: Record<string, OrderReturn['status']> = {
        pending: 'requested', label_generated: 'requested', scheduled: 'requested',
        shipped: 'in_progress', pending_delivered: 'in_progress', not_delivered: 'in_progress',
        pending_cancel: 'in_progress', pending_expiration: 'in_progress', return_to_buyer: 'in_progress',
        delivered: 'completed', cancelled: 'cancelled', expired: 'cancelled',
      }
      if (!statuses[result.status]) throw new Error('Situação de devolução ainda não reconhecida.')
      returns.set(result.id, { id: result.id, status: statuses[result.status] })
    }
    offset += page.data.length
    if (offset >= expected) break
    if (!page.data.length) throw new Error('Consulta incompleta de reclamações.')
  }
  if (claims.size !== expected) throw new Error('Consulta inconsistente de reclamações.')
  return [...returns.values()]
}

export async function readAllOrders(get: (path: string) => Promise<unknown>, sellerId: string, from: Date, to: Date) {
  const records = new Map<string, RemoteOrder>()
  // Seller search omits cancellations by default. Fetch them separately rather
  // than treating every returned order state as a supported search filter.
  for (const status of [null, 'cancelled']) {
    const seen = new Set<string>()
    let offset = 0
    let expected: number | null = null
    while (true) {
      const params = new URLSearchParams({ seller: sellerId, 'order.date_created.from': from.toISOString().replace('Z', '-00:00'), 'order.date_created.to': to.toISOString().replace('Z', '-00:00'), sort: 'date_desc', limit: '50', offset: String(offset) })
      if (status) params.set('order.status', status)
      const page = z.object({ results: z.array(z.unknown()), paging: z.object({ total: z.number().int().nonnegative() }) }).parse(await get(`/orders/search?${params}`))
      if (expected !== null && expected !== page.paging.total) throw new SyncError(409, 'Os pedidos mudaram durante a consulta. Sincronize novamente.')
      expected = page.paging.total
      if (expected > 10000) throw new SyncError(422, 'O volume excede o limite desta sincronização. É necessário importar por intervalos menores.')
      for (const raw of page.results) {
        const order = orderSchema.parse(raw)
        if (order.seller.id !== sellerId) throw new SyncError(502, 'Pedido incompatível com a conta consultada.')
        seen.add(order.id)
        records.set(order.id, order)
      }
      if (records.size > 10000) throw new SyncError(422, 'O volume excede o limite desta sincronização. É necessário importar por intervalos menores.')
      offset += page.results.length
      if (offset >= expected) break
      if (!page.results.length) throw new SyncError(502, 'A API interrompeu a paginação. Nenhum resultado parcial foi publicado.')
    }
    if (seen.size !== expected) throw new SyncError(409, 'Paginação inconsistente. Sincronize novamente.')
  }
  return [...records.values()]
}

export async function syncAccount(db: PrismaClient, accountId: string, request: typeof fetch = fetch) {
  const lock = randomUUID()
  const acquired = await db.marketplaceAccount.updateMany({ where: { id: accountId, marketplace: 'MERCADO_LIVRE', OR: [{ syncLockUntil: null }, { syncLockUntil: { lt: new Date() } }] }, data: { syncLock: lock, syncLockUntil: new Date(Date.now() + 15 * 60_000) } })
  if (!acquired.count) throw new SyncError(409, 'Já existe uma sincronização em andamento para esta conta.')
  const deadline = Date.now() + 10 * 60_000
  try {
    const account = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId }, include: { credentials: true } })
    if (!account.credentials) throw new SyncError(409, 'Reconecte a conta ao Mercado Livre.', true)
    const crypt = vault(process.env.TOKEN_ENCRYPTION_KEY ?? '')
    let tokens = z.object({ accessToken: z.string(), refreshToken: z.string() }).parse(JSON.parse(crypt.open(account.credentials.tokenCipher)))
    let credentialCipher = account.credentials.tokenCipher
    async function refresh() {
      if (!process.env.ML_CLIENT_ID || !process.env.SECRET_KEY_ML) throw new SyncError(503, 'Credenciais da aplicação não configuradas no servidor.')
      const response = await request('https://api.mercadolibre.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID, client_secret: process.env.SECRET_KEY_ML, refresh_token: tokens.refreshToken }), signal: AbortSignal.timeout(20000) })
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string }
        const expired = failure.error === 'invalid_grant' || response.status === 401
        throw new SyncError(expired ? 409 : 502, expired ? 'A autorização expirou ou foi revogada. Reconecte a conta.' : 'O Mercado Livre não permitiu renovar a autorização. Tente novamente.', expired)
      }
      const result = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), user_id: identifier }).parse(await response.json())
      if (result.user_id !== account.externalId) throw new SyncError(502, 'A identidade da autorização não corresponde à conta.')
      tokens = { accessToken: result.access_token, refreshToken: result.refresh_token }
      const cipher = crypt.seal(JSON.stringify(tokens))
      const saved = await db.marketplaceCredential.updateMany({ where: { accountId, tokenCipher: credentialCipher }, data: { tokenCipher: cipher, expiresAt: new Date(Date.now() + result.expires_in * 1000) } })
      if (!saved.count) throw new SyncError(409, 'A autorização foi alterada durante a sincronização. Tente novamente.')
      credentialCipher = cipher
    }
    if (account.credentials.expiresAt.getTime() <= Date.now() + 30000) await refresh()
    async function get(path: string): Promise<unknown> {
      let refreshed = false
      for (let attempt = 0; attempt < 3; attempt++) {
        if (Date.now() > deadline) throw new SyncError(504, 'A sincronização excedeu o tempo limite. Tente novamente.')
        const headers: Record<string, string> = { Authorization: `Bearer ${tokens.accessToken}` }
        if (path.startsWith('/shipments/')) headers['x-format-new'] = 'true'
        if (/^\/shipments\/\d+\/orders$/.test(path)) headers['X-New-Domain'] = 'true'
        const response = await request(`https://api.mercadolibre.com${path}`, { headers, signal: AbortSignal.timeout(20000) })
        if (response.status === 401 && !refreshed) { await refresh(); refreshed = true; continue }
        if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); continue }
        if (!response.ok) {
          if (response.status === 400 && path.startsWith('/orders/search?')) {
            const failure = await response.json().catch(() => null)
            // Classify errors without returning provider payloads, IDs or credentials.
            const description = JSON.stringify(failure ?? {}).toLowerCase()
            const field = /date|fecha/.test(description) ? 'período' : /sort/.test(description) ? 'ordenação' : /status/.test(String(failure?.message ?? '').toLowerCase()) ? 'situação do pedido' : /seller|caller/.test(description) ? 'identificação do vendedor' : /offset|limit/.test(description) ? 'paginação' : null
            const reference = randomUUID()
            const diagnostic = { reference, operation: 'orders.search', providerStatus: response.status, detail: providerFailureDetail(failure, [tokens.accessToken, tokens.refreshToken, process.env.SECRET_KEY_ML ?? '', process.env.TOKEN_ENCRYPTION_KEY ?? '']) }
            throw new SyncError(502, `O Mercado Livre rejeitou a consulta de pedidos (HTTP 400)${field ? `: parâmetro de ${field} inválido` : ''}. Referência: ${reference}.`, false, diagnostic)
          }
          throw new SyncError(response.status === 401 ? 409 : 502, response.status === 403 ? 'O Mercado Livre recusou acesso aos pedidos ou envios. Revise as permissões da aplicação.' : `Consulta ao Mercado Livre falhou (HTTP ${response.status}). Tente novamente.`, response.status === 401)
        }
        return response.json()
      }
      throw new SyncError(502, 'Não foi possível concluir a consulta ao Mercado Livre.')
    }
    const to = new Date()
    to.setUTCMinutes(0, 0, 0)
    to.setUTCHours(to.getUTCHours() + 1)
    const from = new Date(to)
    from.setUTCFullYear(from.getUTCFullYear() - 1)
    const remote = await readAllOrders(get, account.externalId, from, to)
    const shipmentCache = new Map<string, { cost: number | null; status?: string; orderIds: string[] }>()
    const normalized: ReturnType<typeof normalizeOrder>[] = []
    let incomplete = 0
    for (const order of remote) {
      let shipping: number | null = null
      let shipmentStatus: string | undefined
      const shipmentId = order.shipping?.id
      if (shipmentId) {
        if (!shipmentCache.has(shipmentId)) {
          try {
            const shipment = z.object({ status: z.string() }).parse(await get(`/shipments/${shipmentId}`))
            const costs = z.object({ receiver: z.object({ cost: money }) }).parse(await get(`/shipments/${shipmentId}/costs`))
            const linked = z.array(z.object({ order_id: identifier })).parse(await get(`/shipments/${shipmentId}/orders`))
            shipmentCache.set(shipmentId, { cost: costs.receiver.cost, status: shipment.status, orderIds: [...new Set(linked.map(i => i.order_id))] })
          } catch (error) {
            if (error instanceof SyncError && error.reconnect) throw error
            shipmentCache.set(shipmentId, { cost: null, orderIds: [] })
          }
        }
        const shipment = shipmentCache.get(shipmentId)!
        shipmentStatus = shipment.status
        // A shared shipment requires reconciliation; do not charge its full cost to every order.
        if (shipment.cost === 0 || (shipment.orderIds.length === 1 && shipment.orderIds[0] === order.id)) shipping = shipment.cost
      } else if (order.tags?.includes('no_shipping') || order.status === 'cancelled') shipping = 0
      const snapshot = normalizeOrder(order, account.externalId, shipping, shipmentStatus)
      try {
        snapshot.financials.returns = await readReturns(get, order.id, account.externalId)
        snapshot.financials.returnsKnown = true
      } catch (error) {
        if (error instanceof SyncError && error.reconnect) throw error
      }
      if (!snapshot.shippingKnown || !snapshot.financials.refundsKnown || !snapshot.financials.returnsKnown) incomplete++
      normalized.push(snapshot)
    }
    const completedAt = new Date()
    await db.$transaction(async tx => {
      const owned = await tx.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: lock }, data: { lastSyncAt: completedAt, syncFrom: from, syncTo: completedAt, syncError: null, status: 'CONNECTED' } })
      if (!owned.count) throw new SyncError(409, 'A sincronização perdeu sua reserva. Tente novamente.')
      for (const snapshot of normalized) {
        const data = { status: snapshot.status, currency: 'BRL', orderedAt: new Date(snapshot.date), grossAmount: snapshot.financials ? snapshot.financials.productsTotal + snapshot.shipping : remote.find(o => o.id === snapshot.id)!.total_amount, snapshot: snapshot as Prisma.InputJsonValue }
        const saved = await tx.order.upsert({ where: { accountId_externalId: { accountId, externalId: snapshot.id } }, create: { accountId, externalId: snapshot.id, ...data }, update: data })
        await tx.orderItem.deleteMany({ where: { orderId: saved.id } })
        await tx.orderItem.createMany({ data: snapshot.items.map(i => ({ orderId: saved.id, title: i.name, quantity: i.qty, unitPrice: i.unitPrice })) })
      }
    }, { timeout: 60000 })
    return { accountId, orders: normalized.length, incomplete, lastSyncAt: completedAt.toISOString(), from: from.toISOString(), to: completedAt.toISOString() }
  } catch (error) {
    const failure = error instanceof SyncError ? error : new SyncError(502, 'Não foi possível importar os dados. Verifique a conexão e tente novamente.')
    await db.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: lock }, data: { syncError: failure.message, ...(failure.reconnect ? { status: 'EXPIRED' } : {}) } })
    throw failure
  } finally {
    await db.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: lock }, data: { syncLock: null, syncLockUntil: null } })
  }
}

export function registerOrderSync(app: FastifyInstance, db: PrismaClient, authenticated: any, origin: string) {
  app.get('/companies/:id/orders', { preHandler: authenticated }, async (req: any, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
    if (!member) return reply.code(404).send({ error: 'Empresa não encontrada.' })
    const accounts = await db.marketplaceAccount.findMany({ where: { companyId: id }, select: { id: true, marketplace: true, lastSyncAt: true, syncFrom: true, syncTo: true } })
    const rows = await db.order.findMany({ where: { account: { companyId: id } }, select: { snapshot: true, accountId: true }, orderBy: { orderedAt: 'desc' } })
    reply.header('Cache-Control', 'no-store')
    return { orders: rows.filter(row => row.snapshot).map(row => ({ ...(row.snapshot as object), companyId: id, accountId: row.accountId })), coverage: accounts }
  })
  app.post('/companies/:id/accounts/:accountId/sync', { preHandler: authenticated }, async (req: any, reply) => {
    if (req.headers.origin !== origin) return reply.code(403).send({ error: 'Origem não permitida.' })
    const { id, accountId } = z.object({ id: z.string().uuid(), accountId: z.string().uuid() }).parse(req.params)
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
    if (!member) return reply.code(404).send({ error: 'Empresa não encontrada.' })
    if (member.role === 'VIEWER') return reply.code(403).send({ error: 'Somente administradores podem sincronizar contas.' })
    const account = await db.marketplaceAccount.findFirst({ where: { id: accountId, companyId: id, marketplace: 'MERCADO_LIVRE' } })
    if (!account) return reply.code(404).send({ error: 'Conta não encontrada.' })
    try { return await syncAccount(db, accountId) }
    catch (error) {
      if (error instanceof SyncError) {
        if (error.diagnostic) req.log.warn({ mercadoLivre: error.diagnostic }, 'ML_REQUEST_FAILED')
        return reply.code(error.code).send({ error: error.message })
      }
      throw error
    }
  })
}
