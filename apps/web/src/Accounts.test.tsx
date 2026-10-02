import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Accounts from './Accounts'
import { AuthContext } from './auth'
import type { Account } from './data'

function Fixture({ demo = false, canEdit = true, onDisconnected = vi.fn() }) {
  const [accounts, setAccounts] = useState<Account[]>([{ id:'account', companyId:'company', name:'Loja teste', marketplace:'mercadolivre', status:'connected', lastSync:null }])
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
})
