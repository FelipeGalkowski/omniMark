import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Overview from './Overview'
import { AuthContext } from './auth'
import type { Account, Order } from './data'

const account: Account = { id: 'account', companyId: 'company', marketplace: 'mercadolivre', name: 'Loja', status: 'connected', lastSync: null }
const paid: Order = { id: '1', companyId: 'company', accountId: 'account', marketplace: 'mercadolivre', date: new Date(2025, 5, 1), status: 'returned', items: [{ name: 'Produto', qty: 1, unitPrice: 200 }], shipping: 20, financials: { paymentConfirmed: true, discount: 0, refunds: [{ id: 'refund', amount: 50, status: 'confirmed', date: new Date(2025, 6, 1) }], returns: [{ id: 'return', status: 'completed' }] } }
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
const text = (label: string) => screen.getByRole('group', { name: label }).textContent?.replace(/\s/g, ' ')

describe('Cards de indicadores', () => {
  it('mostra venda com frete, reembolso parcial e valor ajustado sem abreviação', () => {
    render(<Overview companyId="company" accounts={[account]} orders={[paid]} onAccounts={() => {}} />)
    expect(text('Faturamento de vendas')).toContain('R$ 220')
    expect(text('Ticket médio')).toContain('R$ 220,00')
    expect(text('Reembolsos confirmados')).toContain('R$ 50')
    expect(text('Vendas após reembolsos')).toContain('R$ 170')
    expect(text('Pedidos no faturamento')).toContain('1')
    expect(text('Devoluções')).toContain('0 em andamento · 1 concluídas')
    expect(text('Pedidos reembolsados')).toContain('1 pedidos')
    expect(document.body.textContent).not.toMatch(/R\$[^\n]*\bmil\b/)
  })
  it('mostra somente espera de sincronização para conta conectada sem dados', () => {
    render(<AuthContext.Provider value={{ user: { id: 'real', name: 'Pessoa', email: 'test@example.invalid', isDemoUser: false }, updateUser: async () => {} }}><Overview companyId="company" accounts={[account]} orders={[]} onAccounts={() => {}} /></AuthContext.Provider>)
    expect(screen.getByText('Aguardando primeira sincronização')).toBeTruthy()
    expect(screen.queryByText('Sua visão geral começa aqui')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Faturamento de vendas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Selecionar período' })).toBeNull()
  })
  it('distingue período vazio de dados ainda não sincronizados', () => {
    render(<Overview companyId="company" accounts={[account]} orders={[]} onAccounts={() => {}} />)
    expect(screen.getByText('Nenhuma venda neste período')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Selecionar período' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Conectar conta' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Faturamento de vendas' })).toBeNull()
  })
  it('mostra apenas o convite para conectar quando a empresa não tem contas', () => {
    render(<Overview companyId="other" accounts={[account]} orders={[paid]} onAccounts={() => {}} />)
    expect(screen.getByText('Sua visão geral começa aqui')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Conectar conta' })).toBeTruthy()
    expect(screen.queryByText('Resultado por canal')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Selecionar período' })).toBeNull()
  })
  it('não oferece canais de outras empresas e acompanha contas carregadas depois', () => {
    const props = { companyId: 'company', orders: [paid], onAccounts: () => {} }
    const view = render(<Overview {...props} accounts={[]} accountsLoading />)
    expect(screen.getByText('Carregando contas')).toBeTruthy()
    view.rerender(<Overview {...props} accounts={[account, { ...account, id: 'other', companyId: 'other', marketplace: 'shopee' }]} />)
    expect(text('Faturamento de vendas')).toContain('R$ 220')
    expect(screen.queryByText('Shopee')).toBeNull()
    expect(screen.queryByText('Magalu')).toBeNull()
  })
  it('preserva o dashboard com histórico quando uma conta precisa reconectar', () => {
    render(<Overview companyId="company" accounts={[{ ...account, status: 'reconnect_needed', lastSync: new Date() }]} orders={[paid]} onAccounts={() => {}} />)
    expect(text('Faturamento de vendas')).toContain('R$ 220')
    expect(screen.getByText(/dados podem estar desatualizados/)).toBeTruthy()
    expect(screen.queryByText('Sua visão geral começa aqui')).toBeNull()
  })
  it('não confunde falha de consulta com ausência de integração', () => {
    render(<Overview companyId="company" accounts={[]} orders={[]} accountsError onAccounts={() => {}} />)
    expect(screen.getByText('Não foi possível consultar as contas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Conectar conta' })).toBeNull()
  })
})
