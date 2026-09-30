import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { normalizeOrder, readAllOrders, readReturns, registerOrderSync, syncAccount } from './order-sync.js'
import { vault } from './mercadolivre.js'

const seller = '42'
const companyId = '2a741c2f-c591-41c3-9bc3-92db19003e1d'
const accountId = '4a741c2f-c591-41c3-9bc3-92db19003e1d'
const raw = (id = 1) => ({ id, seller: { id: 42 }, currency_id: 'BRL', date_created: '2026-09-20T12:00:00Z', status: 'paid', total_amount: 190, order_items: [{ item: { title: 'Produto' }, quantity: 2, unit_price: 100 }], payments: [{ id: 10, status: 'approved', transaction_amount_refunded: 30 }], tags: ['no_shipping'] })
const key = 'ab'.repeat(32)
function database(expired = false) {
  const db: any = {
    marketplaceAccount: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ externalId: seller, credentials: { tokenCipher: vault(key).seal(JSON.stringify({ accessToken: 'old', refreshToken: 'refresh' })), expiresAt: new Date(Date.now() + (expired ? -1000 : 600000)) } })),
    },
    marketplaceCredential: { updateMany: vi.fn(async () => ({ count: 1 })) },
    order: { upsert: vi.fn(async () => ({ id: 'saved' })) },
    orderItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  }
  return db
}
afterEach(() => vi.unstubAllEnvs())

describe('Importação de pedidos', () => {
  it('consulta devoluções e deduplica o mesmo retorno em reclamações distintas', async () => {
    const claim = (id: number) => ({ id, type: 'return', related_entities: ['return'], players: [{ type: 'seller', user_id: 42 }] })
    const get = vi.fn().mockResolvedValueOnce({ paging: { total: 2 }, data: [claim(1), claim(2)] })
      .mockResolvedValueOnce({ id: 99, status: 'delivered', shipments: [{ destination: { address: 'private' } }] })
      .mockResolvedValueOnce({ id: 99, status: 'delivered' })
    expect(await readReturns(get, '123', seller)).toEqual([{ id: '99', status: 'completed' }])
    expect(get.mock.calls[0][0]).toContain('order_id=123')
  })
  it('não converte estado novo ou falha de acesso em zero devoluções', async () => {
    const get = vi.fn().mockResolvedValueOnce({ paging: { total: 1 }, data: [{ id: 1, type: 'return', related_entities: ['return'], players: [{ type: 'seller', user_id: 42 }] }] })
      .mockResolvedValueOnce({ id: 99, status: 'unknown-new-status' })
    await expect(readReturns(get, '123', seller)).rejects.toThrow()
    await expect(readReturns(vi.fn().mockRejectedValue(new Error('403')), '123', seller)).rejects.toThrow()
  })
  it('preserva total do fornecedor, deduplica pagamentos e identifica informações ausentes', () => {
    const input = raw(); input.payments.push(input.payments[0])
    const result = normalizeOrder(input, seller, null)
    expect(result.shippingKnown).toBe(false)
    expect(result.financials).toMatchObject({ productsTotal: 190, refundsKnown: true, returnsKnown: false })
    expect(result.financials.refunds).toHaveLength(1)
    expect(result.financials.refunds[0].amount).toBe(30)
    expect(normalizeOrder({ ...raw(), payments: [{ id: 1, status: 'approved' }] }, seller, 0).financials.refundsKnown).toBe(false)
  })
  it('rejeita pedidos de outro vendedor e IDs numéricos imprecisos', () => {
    expect(() => normalizeOrder(raw(), '99', 0)).toThrow(/outro vendedor/)
    expect(() => normalizeOrder(raw(Number.MAX_SAFE_INTEGER + 1), seller, 0)).toThrow()
  })
  it('inclui cancelados na consulta e percorre todas as páginas', async () => {
    const get = vi.fn().mockResolvedValueOnce({ results: [raw()], paging: { total: 2 } }).mockResolvedValueOnce({ results: [raw(2)], paging: { total: 2 } })
    expect(await readAllOrders(get, seller, new Date('2026-01-01'), new Date('2026-10-01'))).toHaveLength(2)
    expect(get.mock.calls[0][0]).toContain('cancelled')
    expect(get.mock.calls[1][0]).toContain('offset=1')
  })
  it('não publica paginação repetida ou alterada', async () => {
    for (const second of [{ results: [raw()], paging: { total: 2 } }, { results: [], paging: { total: 3 } }]) {
      const get = vi.fn().mockResolvedValueOnce({ results: [raw()], paging: { total: 2 } }).mockResolvedValueOnce(second)
      await expect(readAllOrders(get, seller, new Date('2026-01-01'), new Date('2026-10-01'))).rejects.toThrow()
    }
  })
  it('persiste pedidos somente após leitura completa e libera a reserva', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', key)
    const db = database()
    const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/claims/') ? { data: [], paging: { total: 0 } } : { results: [raw()], paging: { total: 1 } })))
    expect(await syncAccount(db, accountId, request)).toMatchObject({ orders: 1, incomplete: 0 })
    expect(db.order.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId_externalId: { accountId, externalId: '1' } } }))
    expect(db.marketplaceAccount.updateMany.mock.lastCall[0].data).toEqual({ syncLock: null, syncLockUntil: null })
  })
  it('renova e grava o refresh token rotacionado antes de consultar pedidos', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', key); vi.stubEnv('ML_CLIENT_ID', '123'); vi.stubEnv('SECRET_KEY_ML', 'secret')
    const db = database(true)
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new', refresh_token: 'rotated', expires_in: 21600, user_id: 42 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], paging: { total: 0 } })))
    expect(await syncAccount(db, accountId, request)).toMatchObject({ orders: 0 })
    const cipher = db.marketplaceCredential.updateMany.mock.calls[0][0].data.tokenCipher
    expect(JSON.parse(vault(key).open(cipher))).toEqual({ accessToken: 'new', refreshToken: 'rotated' })
    expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer new')
  })
  it('preserva os dados existentes quando o fornecedor falha', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', key)
    const db = database()
    await expect(syncAccount(db, accountId, vi.fn(async () => new Response('{}', { status: 403 })))).rejects.toThrow()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.order.upsert).not.toHaveBeenCalled()
    expect(db.marketplaceAccount.updateMany.mock.calls.some(([args]: any[]) => args.data.syncError)).toBe(true)
  })
  it('impede sincronizações concorrentes', async () => {
    const db = database(); db.marketplaceAccount.updateMany.mockResolvedValueOnce({ count: 0 })
    const request = vi.fn()
    await expect(syncAccount(db, accountId, request)).rejects.toMatchObject({ code: 409 })
    expect(request).not.toHaveBeenCalled()
  })
  it('nega leitura sem vínculo e sincronização por leitor ou origem externa', async () => {
    const app = Fastify()
    const db: any = { companyMember: { findUnique: vi.fn(async () => null) } }
    registerOrderSync(app, db, async (req: any) => { req.currentUser = { id: 'user' } }, 'https://example.test')
    try {
      expect((await app.inject(`/companies/${companyId}/orders`)).statusCode).toBe(404)
      const url = `/companies/${companyId}/accounts/${accountId}/sync`
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(403)
      db.companyMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
      expect((await app.inject({ method: 'POST', url, headers: { origin: 'https://example.test' } })).statusCode).toBe(403)
    } finally { await app.close() }
  })
})
