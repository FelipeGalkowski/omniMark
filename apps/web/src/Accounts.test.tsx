import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Accounts from './Accounts'
import { AuthContext } from './auth'
import type { Account } from './data'

function Fixture({ demo = false, canEdit = true, onDisconnected = vi.fn(), marketplace = 'mercadolivre', synchronization, environment, active }: { demo?: boolean; canEdit?: boolean; onDisconnected?: (accountId: string) => void; marketplace?: Account['marketplace']; synchronization?: Account['synchronization']; environment?: Account['environment']; active?: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([{ id:'account', companyId:'company', name:'Loja teste', marketplace, status:'connected', lastSync:null, synchronization, environment, active }])
  return <AuthContext.Provider value={{ user:{ id:'user', name:'Pessoa', email:'test@example.test', isDemoUser:demo }, updateUser:async () => {} }}>
    <Accounts companyId="company" accounts={accounts} setAccounts={setAccounts} canEdit={canEdit} onDisconnected={onDisconnected} />
  </AuthContext.Provider>
}
describe('Lixeira da conta', () => {
  it('abre a conexão como diálogo e retorna ao botão após Escape', async () => {
    render(<Fixture />)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name:'Conectar nova conta' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name:'Conectar conta' })
    expect(within(dialog).queryByRole('button', { name:'Amazon' })).toBeNull()
    expect(within(dialog).getByRole('button', { name:'Mercado Livre' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
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

describe('Contas de sandbox', () => {
  it('identifica os dados fictícios e explica as permissões antes de abrir o consentimento', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ environment: 'SANDBOX' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    render(<Fixture marketplace="magalu" environment="SANDBOX" active />)
    expect(screen.getByRole('note').textContent).toContain('pedidos desta integração são fictícios')
    expect(screen.getByText('Sandbox · dados fictícios')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Conectar nova conta' }))
    await user.click(screen.getByRole('button', { name: 'Magalu' }))
    expect(await screen.findByText(/Você pode usar seu ID pessoal/)).toBeTruthy()
    expect(screen.getByText(/permissões de catálogo/)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/integrations/magalu/environment', expect.any(Object))
  })
  it('mantém visível a conta de outro ambiente sem anunciar uma sincronização ativa', () => {
    render(<Fixture marketplace="magalu" environment="PRODUCTION" active={false} synchronization={{ supported: true, enabled: false, state: 'environment_mismatch', intervalMinutes: 5, nextAt: null, attemptedAt: null }} />)
    expect(screen.getByText('Outro ambiente')).toBeTruthy()
    expect(screen.getByText(/Seus dados não entram nos pedidos e indicadores atuais/)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByText(/Atualização automática a cada/)).toBeNull()
  })
})
