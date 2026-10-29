import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import Orders from './Orders'
import type { Account, Order } from './data'
import userEvent from '@testing-library/user-event'
import { AuthContext } from './auth'

const account: Account = { id:'audit-account', companyId:'company', marketplace:'magalu', name:'Loja teste', status:'connected', lastSync:new Date() }
const order: Order = { id:'ORDER-TEST', companyId:'company', accountId:account.id, marketplace:'magalu', date:new Date(), status:'paid', items:[{ name:'Produto teste', qty:1, unitPrice:99.9 }], shipping:0 }
function realOrders(accounts: Account[], orders: Order[], props: { loading?: boolean; loadError?: boolean; onRetry?: () => void } = {}) {
  return <AuthContext.Provider value={{ user:{ id:'user', name:'Teste', email:'test@example.test', isDemoUser:false }, updateUser:async () => {} }}><Orders companyId="company" accounts={accounts} orders={orders} {...props} /></AuthContext.Provider>
}
describe('Carregamento e filtros de pedidos', () => {
  it('inclui contas que chegam depois e preserva uma seleção explícita vazia', () => {
    const view = render(realOrders([], [], { loading:true }))
    expect(screen.getByText('Carregando pedidos')).toBeTruthy()
    view.rerender(realOrders([account], [order]))
    expect(screen.getByText(order.id)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name:'Todas as contas' }))
    fireEvent.click(screen.getByRole('button', { name:/Loja teste/ }))
    view.rerender(realOrders([account, { ...account, id:'another' }], [order]))
    expect(screen.queryByText(order.id)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name:'Limpar filtros' }))
    expect(screen.getByText(order.id)).toBeTruthy()
  })
  it('diferencia busca vazia, primeira importação e falha de carregamento', () => {
    const view = render(realOrders([account], [order]))
    fireEvent.change(screen.getByRole('textbox', { name:'Buscar por número do pedido' }), { target:{ value:'missing' } })
    expect(screen.getByText('Nenhum pedido encontrado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name:'Limpar filtros' }))
    view.rerender(realOrders([account], []))
    expect(screen.getByText('Nenhum pedido sincronizado')).toBeTruthy()
    view.rerender(realOrders([account], [], { loadError:true, onRetry:() => {} }))
    expect(screen.getByText('Não foi possível carregar os pedidos')).toBeTruthy()
    expect(screen.queryByText('Nenhum pedido sincronizado')).toBeNull()
    view.rerender(realOrders([account], [order], { loadError:true }))
    expect(screen.getByText(order.id)).toBeTruthy()
    expect(screen.getByText(/Exibindo a última consulta disponível/)).toBeTruthy()
  })
  it('inclui o último milissegundo do dia sem incluir o dia seguinte', () => {
    const now = new Date()
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23,59,59,999)
    render(realOrders([account], [{ ...order, date:end }, { ...order, id:'NEXT-DAY', date:new Date(end.getTime()+1) }]))
    fireEvent.click(screen.getByRole('button', { name:'Selecionar período' }))
    fireEvent.click(screen.getByRole('button', { name:'Mês passado' }))
    expect(screen.getByText(order.id)).toBeTruthy()
    expect(screen.queryByText('NEXT-DAY')).toBeNull()
  })
  it('abre detalhes por teclado, fecha com Escape e devolve o foco', async () => {
    render(realOrders([account], [order]))
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name:`Ver pedido ${order.id}` })
    trigger.focus(); await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name:`Detalhes do pedido ${order.id}` })
    expect(within(dialog).getByRole('button', { name:'Fechar detalhes do pedido' })).toBe(document.activeElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

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
