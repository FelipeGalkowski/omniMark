import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Orders from './Orders'
import type { Account, Order } from './data'

describe('Pedidos por ambiente', () => {
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
