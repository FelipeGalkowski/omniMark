import { describe, expect, it } from 'vitest'
import { confirmedRefunds, orderSale, percentageChange, periodBounds, selectOrders, summarizeOrders } from './kpis'
import { formatBRL, type Order } from './data'

function order(changes: Partial<Order> = {}): Order {
  return { id: '1', companyId: 'company', accountId: 'account', marketplace: 'mercadolivre', date: new Date(2025, 0, 15), status: 'paid', items: [{ name: 'Produto', qty: 2, unitPrice: 100 }], shipping: 30, financials: { paymentConfirmed: true, discount: 10, refunds: [], returns: [] }, ...changes }
}
const refund = (id: string, amount: number) => ({ id, amount, status: 'confirmed' as const, date: new Date(2025, 1, 10) })

describe('Indicadores de vendas', () => {
  it('usa total importado e distingue frete, reembolsos e devoluções desconhecidos', () => {
    const imported = order({ financials: { paymentConfirmed: true, discount: 0, productsTotal: 180, refundsKnown: false, returnsKnown: false, refunds: [], returns: [] } })
    expect(summarizeOrders([imported])).toMatchObject({ gross: 210, refunds: null, adjusted: null, returns: null })
    expect(summarizeOrders([{ ...imported, shippingKnown: false }])).toMatchObject({ complete: false, gross: null, adjusted: null })
  })
  it('inclui frete do comprador e desconta somente o desconto informado', () => {
    expect(orderSale(order())).toBe(220)
    expect(orderSale(order({ shipping: 0 }))).toBe(190)
    expect(formatBRL(29000).replace(/\s/g, ' ')).toBe('R$ 29.000')
  })
  it('mantém centavos sem acumular erro de ponto flutuante', () => {
    const result = summarizeOrders([order({ items: [{ name: 'A', qty: 3, unitPrice: 0.1 }], shipping: 0.2, financials: { paymentConfirmed: true, discount: 0.1, refunds: [], returns: [] } })])
    expect(result.gross).toBe(0.4)
  })
  it('preserva venda cancelada paga e deduz reembolso parcial apenas uma vez', () => {
    const paid = order({ status: 'cancelled', financials: { paymentConfirmed: true, discount: 10, refunds: [refund('r1', 50), refund('r1', 50)], returns: [] } })
    const result = summarizeOrders([paid, paid])
    expect(result).toMatchObject({ gross: 220, refunds: 50, adjusted: 170, count: 1, cancelled: 1, refundOrders: 1 })
  })
  it('não retira uma venda por devolução e não confunde andamento com reembolso', () => {
    const returned = order({ status: 'returned', financials: { paymentConfirmed: true, discount: 10, refunds: [{ ...refund('r1', 220), status: 'pending' }], returns: [{ id: 'ret1', status: 'in_progress' }] } })
    expect(summarizeOrders([returned])).toMatchObject({ gross: 220, refunds: 0, adjusted: 220, returns: 1, returnsPending: 1, returnsCompleted: 0 })
  })
  it('conta devolução por pedido e soma reembolsos distintos, incluindo o frete', () => {
    const returned = order({ financials: { paymentConfirmed: true, discount: 10, refunds: [refund('r1', 100), refund('r2', 120)], returns: [{ id: 'ret1', status: 'completed' }, { id: 'ret2', status: 'completed' }] } })
    expect(summarizeOrders([returned])).toMatchObject({ gross: 220, refunds: 220, adjusted: 0, returns: 1, returnsCompleted: 1 })
  })
  it('exclui pedidos sem pagamento e calcula ticket pelos totais', () => {
    const unpaid = order({ id: '2', status: 'cancelled', financials: { paymentConfirmed: false, discount: 0, refunds: [], returns: [] } })
    const second = order({ id: '3', marketplace: 'shopee', items: [{ name: 'B', qty: 1, unitPrice: 90 }], shipping: 0 })
    expect(summarizeOrders([order(), unpaid, second])).toMatchObject({ gross: 300, count: 2, ticket: 150, cancelled: 1 })
  })
  it('mantém reembolso posterior no período da venda original e isola empresa e contas', () => {
    const paid = order({ financials: { paymentConfirmed: true, discount: 10, refunds: [refund('r1', 50)], returns: [] } })
    const selected = selectOrders([paid, order({ companyId: 'other' }), order({ accountId: 'other' }), order({ id: 'other-channel', marketplace: 'shopee' })], { companyId: 'company', accountIds: ['account'], marketplaces: ['mercadolivre'], from: new Date(2025, 0, 1), until: new Date(2025, 1, 1) })
    expect(summarizeOrders(selected)).toMatchObject({ count: 1, refunds: 50, adjusted: 170 })
  })
  it('não interpreta dados financeiros ausentes como zero', () => {
    expect(summarizeOrders([order({ financials: undefined })])).toMatchObject({ complete: false, gross: null, refunds: null, count: null, ticket: null })
    expect(confirmedRefunds(order({ financials: undefined }))).toBeNull()
    expect(summarizeOrders([])).toMatchObject({ complete: true, gross: 0, count: 0, ticket: null })
    expect(percentageChange(100, 0)).toBeNull()
    expect(percentageChange(150, 100)).toBe(50)
  })
  it('inclui o último milissegundo do período e compara dias de calendário', () => {
    const bounds = periodBounds(new Date(2025, 0, 1), new Date(2025, 0, 31))
    expect(bounds.previousStart).toEqual(new Date(2024, 11, 1))
    expect(bounds.previousEnd).toEqual(new Date(2025, 0, 1))
    const selected = selectOrders([order({ date: new Date(2025, 0, 31, 23, 59, 59, 999) }), order({ id: '2', date: new Date(2025, 1, 1) })], { companyId: 'company', accountIds: ['account'], marketplaces: ['mercadolivre'], from: bounds.start, until: bounds.end })
    expect(selected).toHaveLength(1)
  })
})
