import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Orders from './Orders'
import type { Account, Order } from './data'
import userEvent from '@testing-library/user-event'

describe('Pedidos por ambiente', () => {
  it('mostra o total pago Shopee e mantém frete, descontos e preço de combo indisponíveis', async () => {
    const account: Account = { id: 'sandbox', companyId: 'company', marketplace: 'shopee', name: 'Shopee teste', status: 'connected', lastSync: null, environment: 'SANDBOX', active: true }
    const order: Order = { id: 'SHOPEE-SN', companyId: 'company', accountId: account.id, marketplace: 'shopee', date: new Date(2025, 5, 1), status: 'paid',
      items: [{ name: 'Combo', qty: 2, unitPrice: null }], shipping: 0, shippingKnown: false,
      financials: { orderTotal: 99.9, paymentConfirmed: true, discount: 0, discountKnown: false, refundsKnown: false, returnsKnown: false, refunds: [], returns: [] } }
    render(<Orders companyId="company" accounts={[account]} orders={[order]} />)
    expect(screen.getByRole('note').textContent).toContain('Sandbox Shopee')
    await userEvent.setup().click(screen.getByText('SHOPEE-SN'))
    expect(screen.getByText(/99,90/)).toBeTruthy()
    expect(screen.getByText('Valor unitário').nextElementSibling?.textContent).toBe('—')
    expect(screen.getByText('Frete do comprador').parentElement?.textContent).not.toContain('R$')
    expect(screen.getByText('Descontos').parentElement?.textContent).not.toContain('R$')
  })
  it('identifica os dados fictícios e exclui pedidos de contas de outro ambiente', () => {
    const account: Account = { id: 'sandbox', companyId: 'company', marketplace: 'magalu', name: 'Loja fictícia', status: 'connected', lastSync: null, environment: 'SANDBOX', active: true }
    const order: Order = { id: 'PEDIDO-SANDBOX', companyId: 'company', accountId: account.id, marketplace: 'magalu', date: new Date(2025, 5, 1), status: 'paid', items: [{ name: 'Produto fictício', qty: 1, unitPrice: 99.9 }], shipping: 0 }
    render(<Orders companyId="company" accounts={[account, { ...account, id: 'inactive', name: 'Outro ambiente', active: false }]} orders={[order, { ...order, id: 'PEDIDO-INATIVO', accountId: 'inactive' }]} />)
    expect(screen.getByRole('note').textContent).toContain('Sandbox Magalu')
    expect(screen.getByText('PEDIDO-SANDBOX')).toBeTruthy()
    expect(screen.queryByText('PEDIDO-INATIVO')).toBeNull()
    expect(screen.getByText(/pedidos encontrados/).textContent).toContain('1 pedidos')
  })
})
