import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Accounts from './Accounts'
import { AuthContext } from './auth'
import type { Account } from './data'

function Fixture({ demo = false, canEdit = true, onDisconnected = vi.fn(), marketplace = 'mercadolivre', synchronization }: { demo?: boolean; canEdit?: boolean; onDisconnected?: ReturnType<typeof vi.fn>; marketplace?: Account['marketplace']; synchronization?: Account['synchronization'] }) {
  const [accounts, setAccounts] = useState<Account[]>([{ id:'account', companyId:'company', name:'Loja teste', marketplace, status:'connected', lastSync:null, synchronization }])
  return <AuthContext.Provider value={{ user:{ id:'user', name:'Pessoa', email:'test@example.test', isDemoUser:demo }, updateUser:async () => {} }}>
    <Accounts companyId="company" accounts={accounts} setAccounts={setAccounts} canEdit={canEdit} onDisconnected={onDisconnected} />
  </AuthContext.Provider>
}
describe('Lixeira da conta', () => {
  it('cancela sem requisição e confirma a remoção somente após sucesso', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok:true }), { status:200 }))
    vi.stubGlobal('fetch',fetch)
    const onDisconnected = vi.fn()
    render(<Fixture onDisconnected={onDisconnected} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name:'Desconectar Loja teste' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('pedidos importados serão removidos')
    await user.click(screen.getByRole('button', { name:'Cancelar' }))
    expect(fetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name:'Desconectar Loja teste' }))
    await user.click(screen.getByRole('button', { name:'Desconectar conta' }))
    await screen.findByText('Nenhuma conta conectada')
    expect(fetch).toHaveBeenCalledWith('/api/companies/company/accounts/account', expect.objectContaining({ method:'DELETE' }))
    expect(onDisconnected).toHaveBeenCalledWith('account')
  })
  it('mantém a conta quando a API recusa a operação', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({ error:'Sincronização em andamento.' }), { status:409 })))
    const onDisconnected=vi.fn()
    render(<Fixture onDisconnected={onDisconnected} />)
    const user=userEvent.setup()
    await user.click(screen.getByRole('button', { name:'Desconectar Loja teste' }))
    await user.click(screen.getByRole('button', { name:'Desconectar conta' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Sincronização')
    expect(screen.getByRole('button', { name:'Desconectar Loja teste' })).toBeTruthy()
    expect(onDisconnected).not.toHaveBeenCalled()
  })
  it('remove apenas na demonstração sem acessar o servidor', async () => {
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch)
    render(<Fixture demo />)
    const user=userEvent.setup()
    await user.click(screen.getByRole('button', { name:'Desconectar Loja teste' }))
    await user.click(screen.getByRole('button', { name:'Desconectar conta' }))
    await screen.findByText('Nenhuma conta conectada')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('oculta a lixeira de visualizadores', () => {
    render(<Fixture canEdit={false} />)
    expect(screen.queryByRole('button', { name:'Desconectar Loja teste' })).toBeNull()
  })
  it('mostra a atualização automática Magalu e agenda uma atualização adicional sem anunciar importação concluída', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ queued: true, message: 'Atualização agendada.' }), { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    render(<Fixture marketplace="magalu" synchronization={{ supported: true, enabled: true, state: 'idle', intervalMinutes: 5, nextAt: null, attemptedAt: null }} />)
    expect(screen.getByText(/Atualização automática a cada 5 minutos/)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Atualizar dados' }))
    expect(await screen.findByText('Atualização agendada.')).toBeTruthy()
    expect(screen.queryByText(/pedidos sincronizados/)).toBeNull()
    expect(fetch.mock.calls).toHaveLength(1)
  })
  it('explica quando o conector de um marketplace ainda não está disponível', () => {
    render(<Fixture marketplace="shopee" synchronization={{ supported: false, enabled: false, state: 'unsupported', intervalMinutes: 5, nextAt: null, attemptedAt: null }} />)
    expect(screen.getByText('A importação deste marketplace ainda não está disponível.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Atualizar dados' }).disabled).toBe(true)
  })
})
