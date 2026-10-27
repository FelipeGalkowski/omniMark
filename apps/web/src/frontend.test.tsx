import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Application from './Application'
import LoginPage from './LoginPage'
import SignupPage from './SignupPage'
import { CreateCompanyModal, ManageCompaniesModal } from './CompanyWidgets'

const user = { id: 'user-real', name: 'Pessoa de teste', email: 'pessoa@example.invalid' }
function mockFetch(handler: (path: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const mock = vi.fn(async (path: string, init?: RequestInit) => {
    const result = path === '/api/integrations/magalu/environment' ? { body: { environment: 'PRODUCTION' } } : handler(path, init)
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('Frontend integrado', () => {
  it('conclui o retorno Shopee e identifica o sandbox sem chamar outros provedores', async () => {
    window.history.replaceState(null, '', '/#shopee_state=shopee-test')
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path === '/api/integrations/shopee/complete') return { body: { connected: true, companyId: 'company-real', environment: 'SANDBOX' } }
      return { body: [] }
    })
    render(<Application />)
    await screen.findByText('Conta conectada ao sandbox Shopee. Os pedidos fictícios serão importados automaticamente.')
    expect(window.location.hash).toBe('')
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/complete'))).toEqual([
      ['/api/integrations/shopee/complete', expect.objectContaining({ method: 'POST', body: JSON.stringify({ state: 'shopee-test' }) })],
    ])
  })
  it('não conclui retorno com estados Shopee e Magalu juntos', async () => {
    window.history.replaceState(null, '', '/#shopee_state=a&magalu_state=b')
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      return { body: [] }
    })
    render(<Application />)
    await screen.findByText('Sua visão geral começa aqui')
    expect(fetch.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
    window.history.replaceState(null, '', '/')
  })
  it('inicia a conexão Shopee com aviso de sandbox e mostra configuração pendente sem simular sucesso', async () => {
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path === '/api/integrations/shopee/environment') return { body: { environment: 'SANDBOX' } }
      if (path.endsWith('/shopee/authorize')) return { status: 503, body: { error: 'Configure as credenciais Shopee.' } }
      return { body: [] }
    })
    render(<Application />)
    const action = userEvent.setup()
    await screen.findByText('Sua visão geral começa aqui')
    await action.click(screen.getByRole('button', { name: 'Contas' }))
    await action.click(screen.getByRole('button', { name: 'Conectar nova conta' }))
    await action.click(screen.getByRole('button', { name: 'Shopee' }))
    expect(await screen.findByText(/Sandbox Shopee · dados fictícios/)).toBeTruthy()
    await action.click(screen.getByRole('button', { name: 'Autorizar na Shopee' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Configure as credenciais Shopee.')
    expect(fetch.mock.calls.some(([path, init]) => path.endsWith('/shopee/authorize') && init?.method === 'POST')).toBe(true)
    expect(screen.queryByText('Conta conectada!')).toBeNull()
  })
  it('completa o retorno do Magalu sem chamar a integração do Mercado Livre', async () => {
    window.history.replaceState(null, '', '/#magalu_state=magalu-test')
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path === '/api/integrations/magalu/complete') return { body: { connected: true, companyId: 'company-real' } }
      return { body: [] }
    })
    render(<Application />)
    await screen.findByText('Conta conectada ao Magalu. A importação será iniciada automaticamente.')
    expect(window.location.hash).toBe('')
    expect(fetch.mock.calls.filter(([path]) => path === '/api/integrations/magalu/complete')).toHaveLength(1)
    expect(fetch.mock.calls.some(([path]) => path.includes('/mercadolivre/'))).toBe(false)
  })
  it('não conclui um retorno ambíguo de dois provedores', async () => {
    window.history.replaceState(null, '', '/#magalu_state=a&ml_state=b')
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      return { body: [] }
    })
    render(<Application />)
    await screen.findByText('Sua visão geral começa aqui')
    expect(fetch.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
    window.history.replaceState(null, '', '/')
  })
  it('inicia a autorização no Magalu e identifica configuração pendente', async () => {
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path === '/api/companies/company-real/integrations/magalu/authorize') return { status: 503, body: { error: 'Configure as credenciais do Magalu.' } }
      return { body: [] }
    })
    render(<Application />)
    const action = userEvent.setup()
    await screen.findByText('Sua visão geral começa aqui')
    await action.click(screen.getByRole('button', { name: 'Contas' }))
    await action.click(screen.getByRole('button', { name: 'Conectar nova conta' }))
    await action.click(screen.getByRole('button', { name: 'Magalu' }))
    expect(screen.getByText(/A importação começa automaticamente/)).toBeTruthy()
    await action.click(screen.getByRole('button', { name: 'Autorizar com o ID Magalu' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Configure as credenciais do Magalu.')
    expect(fetch.mock.calls.some(([path, init]) => path.endsWith('/magalu/authorize') && init?.method === 'POST')).toBe(true)
  })
  it('salva o nome da conta real e mantém os pedidos importados automaticamente', async () => {
    let label = 'Loja de teste'
    const fetch = mockFetch((path, init) => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path.endsWith('/account-real') && init?.method === 'PATCH') { label = JSON.parse(init.body as string).name; return { body: { id: 'account-real', name: label } } }
      if (path.endsWith('/accounts')) return { body: [{ id: 'account-real', marketplace: 'MERCADO_LIVRE', label, status: 'CONNECTED', lastSyncAt: new Date().toISOString() }] }
      if (path.endsWith('/orders')) return { body: { orders: [{ id: '123456', companyId: 'company-real', accountId: 'account-real', marketplace: 'mercadolivre', date: new Date().toISOString(), status: 'paid', items: [{ name: 'Produto importado', qty: 1, unitPrice: 50 }], shipping: 0, shippingKnown: true, financials: { paymentConfirmed: true, discount: 0, productsTotal: 50, refunds: [], returns: [], returnsKnown: false } }] } }
      throw new Error(`Unexpected request: ${path}`)
    })
    render(<Application />)
    const action = userEvent.setup()
    await screen.findByRole('button', { name: 'Selecionar período' })
    await action.click(screen.getByRole('button', { name: 'Contas' }))
    await action.click(screen.getByRole('button', { name: 'Renomear Loja de teste' }))
    await action.clear(screen.getByRole('textbox', { name: 'Nome da conta' }))
    await action.type(screen.getByRole('textbox', { name: 'Nome da conta' }), 'Loja organizada')
    await action.click(screen.getByRole('button', { name: 'Salvar nome' }))
    await screen.findByText('Loja organizada')
    expect(fetch.mock.calls.some(([path]) => path.endsWith('/sync'))).toBe(false)
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path.endsWith('/orders'))).toBe(true))
    await action.click(screen.getByRole('button', { name: 'Pedidos' }))
    await screen.findByText('123456')
    expect(screen.queryByText(/Dados fictícios/)).toBeNull()
  })
  it('mostra novos pedidos por consulta periódica sem solicitar sincronização manual e evita reler pedidos sem alterações', async () => {
    let synced = false
    const interval = vi.spyOn(globalThis, 'setInterval')
    const fetch = mockFetch(path => {
      if (path === '/api/auth/me') return { body: { user } }
      if (path === '/api/companies') return { body: [{ id: 'company-real', name: 'Empresa real', role: 'OWNER' }] }
      if (path.endsWith('/accounts')) return { body: [{ id: 'account-real', marketplace: 'MERCADO_LIVRE', label: 'Loja', status: 'CONNECTED', lastSyncAt: synced ? '2026-10-21T15:00:00Z' : null }] }
      if (path.endsWith('/orders')) return { body: { orders: [{ id: 'automatic-123', companyId: 'company-real', accountId: 'account-real', marketplace: 'mercadolivre', date: new Date().toISOString(), status: 'paid', items: [{ name: 'Importado automaticamente', qty: 1, unitPrice: 50 }], shipping: 0, financials: { paymentConfirmed: true, discount: 0, refunds: [], returns: [] } }] } }
      throw new Error(`Unexpected request: ${path}`)
    })
    render(<Application />)
    await screen.findByText('Aguardando primeira sincronização')
    const tick = interval.mock.calls.find(([, delay]) => delay === 15000)![0] as () => void
    synced = true
    await act(async () => { tick() })
    await waitFor(() => expect(fetch.mock.calls.filter(([path]) => path.endsWith('/orders'))).toHaveLength(1))
    await act(async () => { tick() })
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/orders'))).toHaveLength(1)
    expect(fetch.mock.calls.some(([path]) => path.endsWith('/sync'))).toBe(false)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pedidos' }))
    await screen.findByText('automatic-123')
  })
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

  it('envia cadastro à API e exige confirmação de e-mail antes de entrar', async () => {
    const fetch = mockFetch(() => ({ status: 201, body: { verificationRequired: true, email: user.email } }))
    const onVerify = vi.fn()
    render(<SignupPage onVerify={onVerify} onBack={() => {}} />)
    const action = userEvent.setup()
    await action.type(screen.getByPlaceholderText('Seu nome'), user.name)
    await action.type(screen.getByPlaceholderText('seu@email.com'), user.email)
    await action.type(screen.getByPlaceholderText('Mínimo 10 caracteres'), 'senha-longa-de-teste')
    await action.type(screen.getByPlaceholderText('Repita a senha'), 'senha-longa-de-teste')
    await action.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith(user.email))
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
    await screen.findByText(/Atualização automática\./)
    await action.click(screen.getByRole('button', { name: 'Conectar nova conta' }))
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
    await action.click(screen.getByRole('button', { name: 'Conectar nova conta' }))
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
    await screen.findByText('Conta conectada ao Mercado Livre. A importação será iniciada automaticamente.')
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
