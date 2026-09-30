import type { MarketplaceId, Order } from './data'

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)
const uniqueOrders = (orders: Order[]) => [...new Map(orders.map(order => [JSON.stringify([order.companyId, order.accountId, order.id]), order])).values()]

export function orderSale(order: Order): number | null {
  if (!order.financials || order.shippingKnown === false) return null
  const products = order.financials.productsTotal !== undefined ? cents(order.financials.productsTotal) : order.items.reduce((total, item) => total + cents(item.unitPrice) * item.qty, 0) - cents(order.financials.discount)
  return (products + cents(order.shipping)) / 100
}

export function confirmedRefunds(order: Order): number | null {
  if (!order.financials || order.financials.refundsKnown === false) return null
  const refunds = [...new Map(order.financials.refunds.map(refund => [refund.id, refund])).values()]
  return refunds.filter(refund => refund.status === 'confirmed').reduce((total, refund) => total + cents(refund.amount), 0) / 100
}

export function summarizeOrders(input: Order[]) {
  const orders = uniqueOrders(input)
  const complete = orders.every(order => !!order.financials && (!order.financials.paymentConfirmed || orderSale(order) !== null))
  const refundsComplete = orders.every(order => confirmedRefunds(order) !== null)
  const returnsComplete = orders.every(order => !!order.financials && order.financials.returnsKnown !== false)
  const sales = orders.filter(order => order.financials?.paymentConfirmed)
  const grossCents = sales.reduce((total, order) => total + cents(orderSale(order)!), 0)
  const refundedCents = sales.reduce((total, order) => total + cents(confirmedRefunds(order)!), 0)
  const returnStates = orders.map(order => [...new Map((order.financials?.returns ?? []).map(item => [item.id, item])).values()])
  const refundOrders = sales.filter(order => (confirmedRefunds(order) ?? 0) > 0).length
  return {
    complete,
    gross: complete ? grossCents / 100 : null,
    refunds: complete && refundsComplete ? refundedCents / 100 : null,
    adjusted: complete && refundsComplete ? (grossCents - refundedCents) / 100 : null,
    count: complete ? sales.length : null,
    ticket: complete && sales.length ? grossCents / 100 / sales.length : null,
    refundOrders: refundsComplete ? refundOrders : null,
    cancelled: orders.filter(order => order.status === 'cancelled').length,
    cancelledValue: orders.filter(order => order.status === 'cancelled').every(order => orderSale(order) !== null) ? orders.filter(order => order.status === 'cancelled').reduce((total, order) => total + cents(orderSale(order)!), 0) / 100 : null,
    returns: returnsComplete ? returnStates.filter(states => states.some(item => item.status !== 'cancelled')).length : null,
    returnsPending: returnsComplete ? returnStates.filter(states => states.some(item => item.status === 'requested' || item.status === 'in_progress')).length : null,
    returnsCompleted: returnsComplete ? returnStates.filter(states => states.some(item => item.status === 'completed')).length : null,
  }
}

export function periodBounds(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1)
  const days = Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000) + 1
  const previousStart = new Date(start)
  previousStart.setDate(previousStart.getDate() - days)
  return { start, end, previousStart, previousEnd: start }
}

export function selectOrders(orders: Order[], filters: { companyId: string; accountIds: string[]; marketplaces: MarketplaceId[]; from: Date; until: Date }) {
  return uniqueOrders(orders).filter(order => order.companyId === filters.companyId && filters.accountIds.includes(order.accountId) && filters.marketplaces.includes(order.marketplace) && order.date >= filters.from && order.date < filters.until)
}

export function percentageChange(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous === 0 ? null : (current - previous) / Math.abs(previous) * 100
}
