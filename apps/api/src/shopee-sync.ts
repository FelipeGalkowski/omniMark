import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { SyncError } from './order-sync.js'
import type { SyncExecution } from './sync-contract.js'
import { shopeeConfiguration, shopeeSignedUrl, refreshShopeeCredential, type ShopeeTokens } from './shopee-client.js'

const orderId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const money = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100)
const timestamp = z.number().int().nonnegative().max(253402300799)
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100)
const statusSchema = z.enum(['UNPAID', 'PENDING', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED', 'IN_CANCEL', 'CANCELLED', 'INVOICE_PENDING'])
const remoteOrder = z.object({
  order_sn: orderId, region: z.literal('BR'), currency: z.literal('BRL'), order_status: statusSchema,
  create_time: timestamp, update_time: timestamp, pay_time: timestamp.nullish(), total_amount: money.nullish(),
  item_list: z.array(z.object({ item_name: z.string().min(1).max(1000), model_name: z.string().max(1000).optional(),
    model_quantity_purchased: z.number().int().positive().max(1000000), model_discounted_price: money.nullish(),
    promotion_type: z.string().optional(), promotion_list: z.array(z.object({ promotion_type: z.string() })).optional(),
  })).min(1).max(1000),
})

export function normalizeShopeeOrder(raw: unknown) {
  const parsed = remoteOrder.safeParse(raw)
  if (!parsed.success) throw new SyncError(502, 'A Shopee retornou um pedido com campos, moeda, região ou situação inválidos. A importação anterior foi preservada.')
  const order = parsed.data
  const paymentConfirmed = !!order.pay_time || ['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED', 'INVOICE_PENDING'].includes(order.order_status)
  const status = order.order_status === 'CANCELLED' ? 'cancelled' : order.order_status === 'COMPLETED' ? 'delivered'
    : order.order_status === 'SHIPPED' ? 'shipped' : paymentConfirmed ? 'paid' : 'pending'
  // total_amount is the buyer-paid total (including buyer freight/promotions).
  // actual_shipping_fee is a carrier cost; never substitute it for buyer freight.
  const total = order.total_amount == null ? null : cents(order.total_amount) / 100
  return { id: order.order_sn, marketplace: 'shopee', date: new Date(order.create_time * 1000).toISOString(), status,
    items: order.item_list.map(item => {
      const bundle = item.promotion_type === 'bundle_deal' || item.promotion_list?.some(p => p.promotion_type === 'bundle_deal')
      return { name: item.model_name ? `${item.item_name} · ${item.model_name}` : item.item_name, qty: item.model_quantity_purchased,
        unitPrice: bundle || item.model_discounted_price == null ? null : cents(item.model_discounted_price) / 100 }
    }),
    shipping: 0, shippingKnown: false,
    financials: { orderTotal: total, discount: 0, discountKnown: false, paymentConfirmed,
      refundsKnown: false, returnsKnown: false, refunds: [], returns: [] },
  }
}

export function shopeeDateRanges(from: Date, to: Date) {
  const start = Math.floor(from.getTime() / 1000), end = Math.floor(to.getTime() / 1000)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end) throw new SyncError(422, 'Período Shopee inválido.')
  const ranges: { from: number; to: number }[] = []
  // The API accepts 15 days; leave a day for inclusive boundaries.
  for (let value = start; value < end;) {
    const until = Math.min(value + 14 * 86400, end)
    ranges.push({ from: value, to: until }); value = until
  }
  return ranges
}

type Get = (path: string, query: URLSearchParams) => Promise<unknown>
const listPage = z.object({ more: z.boolean(), next_cursor: z.string().max(4096), order_list: z.array(z.object({ order_sn: orderId })).max(100) })
const detailPage = z.object({ order_list: z.array(z.unknown()).max(50) })
export async function readShopeeOrders(get: Get, from: Date, to: Date, incremental: boolean) {
  const ids = new Set<string>()
  let pages = 0
  for (const range of shopeeDateRanges(from, to)) {
    let cursor = ''
    const cursors = new Set<string>(), seen = new Set<string>()
    for (;;) {
      if (++pages > 201) throw new SyncError(422, 'A paginação Shopee excedeu o limite desta importação.')
      const query = new URLSearchParams({ time_range_field: incremental ? 'update_time' : 'create_time',
        time_from: String(range.from), time_to: String(range.to), page_size: '100', cursor, request_order_status_pending: 'true' })
      const result = listPage.safeParse(await get('/api/v2/order/get_order_list', query))
      if (!result.success) throw new SyncError(502, 'A Shopee retornou uma página de pedidos inválida.')
      const page = result.data
      for (const order of page.order_list) {
        if (seen.has(order.order_sn)) throw new SyncError(409, 'Os pedidos Shopee mudaram durante a consulta. A atualização será repetida automaticamente.')
        seen.add(order.order_sn); ids.add(order.order_sn)
        if (ids.size > 10000) throw new SyncError(422, 'O histórico Shopee excede o limite desta importação.')
      }
      if (!page.more) break
      if (!page.order_list.length || !page.next_cursor || page.next_cursor === cursor || cursors.has(page.next_cursor)) throw new SyncError(502, 'A Shopee retornou uma paginação inconsistente.')
      cursors.add(page.next_cursor); cursor = page.next_cursor
    }
  }
  const orders: ReturnType<typeof normalizeShopeeOrder>[] = [], allIds = [...ids]
  for (let offset = 0; offset < allIds.length; offset += 50) {
    const batch = allIds.slice(offset, offset + 50), remaining = new Set(batch)
    const result = detailPage.safeParse(await get('/api/v2/order/get_order_detail', new URLSearchParams({ order_sn_list: batch.join(','),
      response_optional_fields: 'item_list,pay_time,total_amount', request_order_status_pending: 'true' })))
    if (!result.success) throw new SyncError(502, 'A Shopee retornou detalhes de pedidos inválidos.')
    for (const raw of result.data.order_list) {
      const order = normalizeShopeeOrder(raw)
      if (!remaining.delete(order.id)) throw new SyncError(502, 'A Shopee retornou um pedido duplicado ou não solicitado.')
      orders.push(order)
    }
    if (remaining.size) throw new SyncError(502, 'A Shopee não retornou todos os pedidos solicitados. Nenhum resultado parcial foi publicado.')
  }
  return orders
}

export async function syncShopeeAccount(db: PrismaClient, accountId: string, request: typeof fetch, execution: SyncExecution) {
  let config: ReturnType<typeof shopeeConfiguration>
  try { config = shopeeConfiguration(process.env.WEB_ORIGIN ?? '') } catch { throw new SyncError(503, 'A integração Shopee aguarda a configuração no servidor.') }
  const account = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId }, include: { credentials: true } })
  if (account.marketplace !== 'SHOPEE' || account.environment !== config.environment || account.syncLock !== execution.lease) throw new SyncError(409, 'A sincronização Shopee perdeu sua reserva ou pertence a outro ambiente.')
  if (!account.credentials) throw new SyncError(409, 'Reconecte sua loja Shopee.', true)
  let tokens: ShopeeTokens
  try {
    tokens = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), shopId: z.string(), partnerId: z.string() })
      .parse(JSON.parse(config.crypt.open(account.credentials.tokenCipher)))
  } catch { throw new SyncError(409, 'As credenciais Shopee precisam de uma nova conexão.', true) }
  if (tokens.shopId !== account.externalId || tokens.partnerId !== config.partnerId) throw new SyncError(409, 'A autorização Shopee não corresponde à loja ou ao aplicativo.', true)
  const refresh = async () => { tokens = (await refreshShopeeCredential(db, accountId, config, execution, request)).tokens }
  if (account.credentials.expiresAt.getTime() <= Date.now() + 30000) await refresh()
  const deadline = Date.now() + 10 * 60_000
  const get: Get = async (path, query) => {
    let refreshed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline) throw new SyncError(504, 'A atualização Shopee excedeu o tempo limite. Uma nova tentativa será feita automaticamente.')
      const url = shopeeSignedUrl(config, path, { shopId: tokens.shopId, accessToken: tokens.accessToken })
      for (const [key, value] of query) url.searchParams.set(key, value)
      let response: Response
      try { response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(20000) }) }
      catch { throw new SyncError(502, 'Não foi possível consultar os pedidos Shopee. A atualização será repetida automaticamente.') }
      const body = z.object({ error: z.string(), response: z.unknown().optional() }).safeParse(await response.json().catch(() => null))
      const error = body.success ? body.data.error : ''
      if (response.status === 429) {
        const retry = response.headers.get('retry-after') ?? ''
        throw new SyncError(429, 'A Shopee limitou as consultas. A atualização será repetida automaticamente.', false, undefined,
          /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0)
      }
      if (response.status === 401 || error === 'common.error_auth') {
        if (refreshed) throw new SyncError(409, 'A Shopee recusou a autorização renovada. Reconecte a loja.', true)
        await refresh(); refreshed = true; continue
      }
      if ((response.status >= 500 || ['error_server', 'error_network'].includes(error)) && attempt < 2) continue
      if (response.status === 403 || error === 'error_permission') throw new SyncError(409, 'A Shopee recusou acesso aos pedidos. Confira as permissões e reconecte a loja.', true)
      if (!response.ok || !body.success || error || body.data.response === undefined) throw new SyncError(502, 'Não foi possível ler todos os pedidos Shopee. A importação anterior foi preservada.')
      return body.data.response
    }
    throw new SyncError(502, 'Não foi possível atualizar os pedidos Shopee.')
  }
  const to = new Date(), historyStart = new Date(to)
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 1)
  const full = !account.lastFullSyncAt || !account.syncTo || Date.now() - account.lastFullSyncAt.getTime() >= 86400000
  const from = full ? historyStart : new Date(Math.max(historyStart.getTime(), account.syncTo!.getTime() - 15 * 60000))
  const orders = await readShopeeOrders(get, from, to, !full), completedAt = new Date()
  await db.$transaction(async tx => {
    const owned = await tx.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: execution.lease, syncLockUntil: { gt: new Date() }, environment: config.environment },
      data: { lastSyncAt: completedAt, syncFrom: full ? from : account.syncFrom ?? historyStart, syncTo: to,
        ...(full ? { lastFullSyncAt: completedAt } : {}), syncError: null, status: 'CONNECTED' } })
    if (owned.count !== 1) throw new SyncError(409, 'A sincronização Shopee perdeu sua reserva.')
    for (const snapshot of orders) {
      const data = { status: snapshot.status, currency: 'BRL', orderedAt: new Date(snapshot.date),
        grossAmount: snapshot.financials.orderTotal, snapshot: snapshot as Prisma.InputJsonValue }
      const saved = await tx.order.upsert({ where: { accountId_externalId: { accountId, externalId: snapshot.id } },
        create: { accountId, externalId: snapshot.id, ...data }, update: data })
      await tx.orderItem.deleteMany({ where: { orderId: saved.id } })
      await tx.orderItem.createMany({ data: snapshot.items.map(item => ({ orderId: saved.id, title: item.name, quantity: item.qty, unitPrice: item.unitPrice })) })
    }
  }, { timeout: 60000 })
  return { orders: orders.length, incomplete: orders.length }
}
