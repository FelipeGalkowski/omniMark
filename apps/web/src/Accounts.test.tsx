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
  it('renomeia a conta Magalu após salvar no servidor, sem solicitar sincronização', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'account', name: 'Loja principal' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    render(<Fixture marketplace="magalu" synchronization={{ supported: true, enabled: true, state: 'idle', intervalMinutes: 5, nextAt: null, attemptedAt: null }} />)
    expect(screen.getByText(/Atualização automática a cada 5 minutos/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Atualizar dados' })).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Renomear Loja teste' }))
    const input = screen.getByRole('textbox', { name: 'Nome da conta' })
    await user.clear(input); await user.type(input, '  Loja principal  ')
    await user.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(await screen.findByText('Loja principal')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/companies/company/accounts/account', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Loja principal' }) }))
    expect(fetch.mock.calls).toHaveLength(1)
  })
  it('explica quando o conector de um marketplace ainda não está disponível', () => {
    render(<Fixture marketplace="shopee" synchronization={{ supported: false, enabled: false, state: 'unsupported', intervalMinutes: 5, nextAt: null, attemptedAt: null }} />)
    expect(screen.getByText('A importação deste marketplace ainda não está disponível.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Atualizar dados' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Renomear Loja teste' }).disabled).toBe(false)
  })
})

describe('Renomear contas', () => {
  it('mantém o nome anterior e a edição aberta quando o servidor recusa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Sem permissão.' }), { status: 403 })))
    render(<Fixture />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Renomear Loja teste' }))
    await user.clear(screen.getByRole('textbox', { name: 'Nome da conta' }))
    await user.type(screen.getByRole('textbox', { name: 'Nome da conta' }), 'Outro nome')
    await user.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Sem permissão.')
    expect(screen.getByText('Loja teste')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('valida nome vazio, cancela sem salvar e permite renomear na demonstração durante a sincronização', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    render(<Fixture demo synchronization={{ supported: true, enabled: true, state: 'running', intervalMinutes: 5, nextAt: null, attemptedAt: null }} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Renomear Loja teste' }))
    await user.clear(screen.getByRole('textbox', { name: 'Nome da conta' }))
    await user.type(screen.getByRole('textbox', { name: 'Nome da conta' }), '   ')
    await user.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(screen.getByRole('alert').textContent).toContain('Informe um nome')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Loja teste')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Renomear Loja teste' }))
    await user.clear(screen.getByRole('textbox', { name: 'Nome da conta' }))
    await user.type(screen.getByRole('textbox', { name: 'Nome da conta' }), 'Loja matriz')
    await user.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(screen.getByText('Loja matriz')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('oculta a edição para visualizadores', () => {
    render(<Fixture canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Renomear Loja teste' })).toBeNull()
  })
})
