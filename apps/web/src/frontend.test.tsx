import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Application from './Application'
import LoginPage from './LoginPage'
import SignupPage from './SignupPage'
import { CreateCompanyModal, ManageCompaniesModal } from './CompanyWidgets'

const user = { id: 'user-real', name: 'Pessoa de teste', email: 'pessoa@example.invalid' }
function mockFetch(handler: (path: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const mock = vi.fn(async (path: string, init?: RequestInit) => {
    const result = handler(path, init)
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('Frontend integrado', () => {
  it('valida o login no servidor, sem aceitar um usuário gravado no armazenamento local', async () => {
    localStorage.setItem('omnimark_users', JSON.stringify([{ ...user }]))
    const fetch = mockFetch(() => ({ status: 401, body: { error: 'Credenciais inválidas' } }))
    const onLogin = vi.fn()
    render(<LoginPage onLogin={onLogin} onSignup={() => {}} onForgot={() => {}} />)
    const action = userEvent.setup()
    await action.type(screen.getByPlaceholderText('seu@email.com'), user.email)
    await action.type(screen.getByPlaceholderText('••••••••'), 'senha-incorreta')
    await action.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Credenciais inválidas')
    expect(onLogin).not.toHaveBeenCalled()
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/login')
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).password).toBe('senha-incorreta')
    expect(localStorage.getItem('omnimark_session')).toBeNull()
  })

  it('envia cadastro à API e usa a identidade retornada pelo servidor', async () => {
    const fetch = mockFetch(() => ({ status: 201, body: { user } }))
    const onLogin = vi.fn()
    render(<SignupPage onLogin={onLogin} onBack={() => {}} />)
    const action = userEvent.setup()
    await action.type(screen.getByPlaceholderText('Seu nome'), user.name)
    await action.type(screen.getByPlaceholderText('seu@email.com'), user.email)
    await action.type(screen.getByPlaceholderText('Mínimo 10 caracteres'), 'senha-longa-de-teste')
    await action.type(screen.getByPlaceholderText('Repita a senha'), 'senha-longa-de-teste')
    await action.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ ...user, isDemoUser: false }))
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/register')
    expect(localStorage.getItem('omnimark_users')).toBeNull()
  })

  it('restaura a sessão real, mostra ausência de dados e impede conexão simulada', async () => {
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      return { body: [] }
    })
    render(<Application />)
    const action = userEvent.setup()
    await screen.findByText('Sua visão geral começa aqui')
    expect(screen.queryByText('TechStore Brasil')).toBeNull()
    expect(screen.queryByText(/Dados fictícios de 2025/)).toBeNull()
    await action.click(screen.getByRole('button', { name: 'Contas' }))
    await screen.findByText('Conecte sua conta do Mercado Livre.')
    await action.click(screen.getByRole('button', { name: '+ Conectar conta' }))
    await action.click(screen.getByRole('button', { name: 'Mercado Livre' }))
    await screen.findByText('Autorizar Mercado Livre')
    expect(screen.getByRole('button', { name: 'Autorizar no Mercado Livre' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Conectar' })).toBeNull()
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })

  it('mostra configuração pendente ao iniciar autorização real', async () => {
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path.endsWith('/authorize')) return { status: 503, body: { error: 'Configure o endereço HTTPS de retorno.' } }
      return { body: [] }
    })
    render(<Application />)
    const action = userEvent.setup()
    await screen.findByText('Sua visão geral começa aqui')
    await action.click(screen.getByRole('button', { name: 'Contas' }))
    await action.click(screen.getByRole('button', { name: '+ Conectar conta' }))
    await action.click(screen.getByRole('button', { name: 'Mercado Livre' }))
    await action.click(screen.getByRole('button', { name: 'Autorizar no Mercado Livre' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Configure o endereço HTTPS de retorno.')
    expect(fetch.mock.calls.some(([path, init]) => path.endsWith('/authorize') && init?.method === 'POST')).toBe(true)
    expect(screen.queryByText('Conta conectada!')).toBeNull()
  })

  it('conclui o retorno OAuth uma vez e remove o identificador da URL', async () => {
    window.history.replaceState(null, '', '/#ml_state=state-test')
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path.endsWith('/complete')) return { body: { connected: true, companyId: 'company-real' } }
      return { body: [] }
    })
    render(<Application />)
    await screen.findByText('Conta conectada ao Mercado Livre. A importação de pedidos ainda não está disponível.')
    expect(window.location.hash).toBe('')
    await screen.findByText('Contas e Integrações')
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/complete'))).toHaveLength(1)
  })

  it('mostra falhas de sessão sem anunciar que o serviço está disponível', async () => {
    mockFetch(() => ({ status: 503, body: { error: 'Servidor temporariamente indisponível' } }))
    render(<Application />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Servidor temporariamente indisponível')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy()
  })

  it('mantém demonstração isolada e permite navegar por pedidos, filtros e calendário', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const fetch = mockFetch(() => ({ status: 401, body: { error: 'Não autenticado' } }))
    render(<Application />)
    const action = userEvent.setup()
    await action.click(await screen.findByRole('button', { name: 'Explorar demonstração' }))
    await screen.findByText(/Dados fictícios de 2025/)
    await action.click(screen.getByRole('button', { name: 'Pedidos' }))
    await screen.findByText(/pedidos encontrados/)
    await action.click(screen.getByRole('button', { name: 'Selecionar período' }))
    await action.click(screen.getByRole('button', { name: 'Este mês' }))
    expect(screen.getByRole('button', { name: 'Selecionar período' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: 'Selecionar período' }).textContent).toContain('dez.')
    await action.type(screen.getByPlaceholderText('Buscar por nº do pedido…'), 'pedido-inexistente')
    await screen.findByText('Nenhum pedido encontrado')
    await action.click(screen.getByRole('button', { name: 'Sair da demonstração' }))
    await screen.findByRole('button', { name: 'Entrar' })
    expect(fetch.mock.calls.every(([path]) => path === '/api/auth/me')).toBe(true)
    expect(localStorage.getItem('omnimark_session')).toBeNull()
  })

  it('preserva os campos quando o cadastro de empresa falha e permite tentar novamente', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('Falha ao salvar')).mockResolvedValueOnce(undefined)
    const onClose = vi.fn()
    render(<CreateCompanyModal onCreate={onCreate} onClose={onClose} />)
    const action = userEvent.setup()
    await action.type(screen.getByPlaceholderText('Ex: TechStore Brasil'), 'Minha empresa')
    await action.click(screen.getByRole('button', { name: 'Cadastrar empresa' }))
    await screen.findByRole('alert')
    expect(screen.getByPlaceholderText('Ex: TechStore Brasil')).toHaveProperty('value', 'Minha empresa')
    expect(onClose).not.toHaveBeenCalled()
    await action.click(screen.getByRole('button', { name: 'Cadastrar empresa' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
  })

  it('envia uma única empresa editada e espera a confirmação antes de fechar o formulário', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<ManageCompaniesModal companies={[{ id: 'co', name: 'Nome antigo' }]} accounts={[]} onClose={() => {}} onUpdate={onUpdate} onCreateOpen={() => {}} />)
    const action = userEvent.setup()
    await action.click(screen.getByRole('button', { name: 'Editar' }))
    const field = screen.getByLabelText('Nome de exibição *')
    await action.clear(field)
    await action.type(field, 'Nome atualizado')
    await action.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'co', name: 'Nome atualizado' })))
    await waitFor(() => expect(screen.queryByText('Editando: Nome antigo')).toBeNull())
  })
})
