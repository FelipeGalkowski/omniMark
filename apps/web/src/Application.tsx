import { useEffect, useRef, useState } from 'react'
import { ALL_ORDERS, DEFAULT_COMPANIES, INITIAL_ACCOUNTS, type Account, type Company, type Page, type Order } from './data'
import { ThemeContext, type ThemeMode } from './theme'
import { AuthContext, type User } from './auth'
import { loadJSON, saveJSON } from './utils'
import { api, ApiError, accountFromApi, orderFromApi, companyFromApi, companyPayload, createCompany, type AccountRecord, type OrderRecord, type CompanyRecord, type UserRecord } from './api'
import { Spinner, btnSec } from './ui'
import LoginPage from './LoginPage'
import SignupPage from './SignupPage'
import ForgotPage from './RecoveryInfo'
import OnboardingPage from './WelcomePage'
import Overview from './Overview'
import OrdersPage from './Orders'
import AccountsPage from './Accounts'
import MyAccountPage from './MyAccountPage'
import { UserMenu, CompanySelector, CreateCompanyModal, ManageCompaniesModal } from './CompanyWidgets'

export default function App() {
  const [themeMode, setThemeModeRaw] = useState<ThemeMode>(() => {
    const value = loadJSON<ThemeMode>('omnimark_theme', 'system')
    return ['light', 'dark', 'system'].includes(value) ? value : 'system'
  })
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [authScreen, setAuthScreen] = useState<'login' | 'signup' | 'forgot'>('login')
  const [companies, setCompanies] = useState<Company[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [accountRequest, setAccountRequest] = useState({ companyId: '', status: 'loading' })
  const [companyId, setCompanyId] = useState('')
  const [page, setPage] = useState<Page>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [companyError, setCompanyError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const requestVersion = useRef(0)
  const [oauthState] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('ml_state'))
  const oauthStarted = useRef(false)
  const [connectionMessage, setConnectionMessage] = useState('')
  useEffect(() => { if (oauthState) window.history.replaceState(null, '', window.location.pathname + window.location.search) }, [oauthState])
  useEffect(() => {
    if (!oauthState || !user || user.isDemoUser || loading || !companies.length || oauthStarted.current) return
    oauthStarted.current = true
    setConnectionMessage('Concluindo conexão com o Mercado Livre…')
    api<{ companyId: string }>('/integrations/mercadolivre/complete', { method: 'POST', body: JSON.stringify({ state: oauthState }) })
      .then(result => { setCompanyId(result.companyId); setPage('accounts'); setReloadKey(key => key + 1); setConnectionMessage('Conta conectada ao Mercado Livre. Clique em Atualizar dados para importar seus pedidos.') })
      .catch((failure: Error) => setConnectionMessage(failure.message))
  }, [oauthState, user, loading, companies])
  const isDark = themeMode === 'dark' || (themeMode === 'system' && sysDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setSysDark(event.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])
  useEffect(() => { document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light') }, [isDark])
  function setThemeMode(mode: ThemeMode) { setThemeModeRaw(mode); saveJSON('omnimark_theme', mode) }

  useEffect(() => {
    const controller = new AbortController()
    api<{ user: UserRecord }>('/auth/me', { signal: controller.signal })
      .then(result => setUser({ ...result.user, isDemoUser: false }))
      .catch((failure: Error) => {
        if (failure.name !== 'AbortError' && !(failure instanceof ApiError && failure.status === 401)) setError(failure.message)
      })
      .finally(() => { if (!controller.signal.aborted) setReady(true) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!user || user.isDemoUser) return
    const controller = new AbortController()
    setLoading(true); setCompanyError('')
    api<CompanyRecord[]>('/companies', { signal: controller.signal })
      .then(records => {
        const next = records.map(companyFromApi)
        setCompanies(next)
        setCompanyId(current => next.some(company => company.id === current) ? current : next[0]?.id ?? '')
      })
      .catch((failure: Error) => { if (failure.name !== 'AbortError') setCompanyError(failure.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [user?.id, user?.isDemoUser, reloadKey])

  useEffect(() => {
    if (!user || user.isDemoUser || !companyId) return
    const controller = new AbortController()
    const version = ++requestVersion.current
    setAccounts([]); setOrders([]); setError('')
    setAccountRequest({ companyId, status: 'loading' })
    api<AccountRecord[]>(`/companies/${companyId}/accounts`, { signal: controller.signal })
      .then(async records => {
        const result = records.some(record => record.lastSyncAt) ? await api<{ orders: OrderRecord[] }>(`/companies/${companyId}/orders`, { signal: controller.signal }) : { orders: [] }
        if (version === requestVersion.current) {
          setAccounts(records.map(record => accountFromApi(record, companyId)))
          setOrders(result.orders.map(orderFromApi))
          setAccountRequest({ companyId, status: 'ready' })
        }
      })
      .catch((failure: Error) => { if (failure.name !== 'AbortError' && version === requestVersion.current) { setError(failure.message); setAccountRequest({ companyId, status: 'error' }) } })
    return () => { controller.abort(); requestVersion.current++ }
  }, [user?.id, user?.isDemoUser, companyId, reloadKey])

  function handleLogin(next: User) {
    requestVersion.current++
    setOrders([])
    setUser(next); setError(''); setCompanyError(''); setPage('overview')
    setCompanies(next.isDemoUser ? DEFAULT_COMPANIES.map(company => ({ ...company })) : [])
    setAccounts(next.isDemoUser ? INITIAL_ACCOUNTS.map(account => ({ ...account })) : [])
    setCompanyId(next.isDemoUser ? DEFAULT_COMPANIES[0].id : '')
    setLoading(!next.isDemoUser)
  }
  async function handleLogout() {
    try {
      if (!user?.isDemoUser) await api('/auth/logout', { method: 'POST' })
    } catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 401)) { setError((failure as Error).message); return }
    }
    requestVersion.current++
    setUser(null); setCompanies([]); setAccounts([]); setOrders([]); setCompanyId(''); setLoading(false)
    setError(''); setCompanyError(''); setShowCreate(false); setShowManage(false); setAuthScreen('login'); setPage('overview')
  }
  async function updateUser(updates: { name: string }) {
    if (!user) return
    if (user.isDemoUser) { setUser({ ...user, ...updates }); return }
    const result = await api<{ user: UserRecord }>('/auth/me', { method: 'PATCH', body: JSON.stringify(updates) })
    setUser({ ...result.user, isDemoUser: false })
  }
  async function addCompany(input: Omit<Company, 'id'>) {
    const company = user?.isDemoUser ? { ...input, id: `demo-${crypto.randomUUID()}` } : await createCompany(input)
    setCompanies(previous => [...previous, company]); setCompanyId(company.id); setPage('overview'); setShowCreate(false)
  }
  async function updateCompany(input: Company) {
    const company = user?.isDemoUser ? input : companyFromApi(await api<CompanyRecord>(`/companies/${input.id}`, { method: 'PATCH', body: JSON.stringify(companyPayload(input)) }))
    setCompanies(previous => previous.map(item => item.id === company.id ? company : item))
  }

  const company = companies.find(item => item.id === companyId)
  const demo = !!user?.isDemoUser
  return <ThemeContext.Provider value={{ isDark, mode: themeMode, setMode: setThemeMode }}>
    {!ready ? <Spinner /> : !user ? <>
      {error && <div className="app-alert" role="alert">{error}</div>}
      {authScreen === 'signup' ? <SignupPage onLogin={handleLogin} onBack={() => setAuthScreen('login')} /> : authScreen === 'forgot' ? <ForgotPage onBack={() => setAuthScreen('login')} /> : <LoginPage onLogin={handleLogin} onSignup={() => setAuthScreen('signup')} onForgot={() => setAuthScreen('forgot')} />}
    </> : <AuthContext.Provider value={{ user, updateUser }}>
      <div className="app-shell">
        <header className="app-header">
          <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('overview') }} aria-label="Omnimark — visão geral"><span className="brand-mark">OM</span><span>Omnimark</span></a>
          <span className="header-divider" />
          {company && <CompanySelector company={company} companies={companies} accounts={accounts} onSwitch={id => { setAccounts(demo ? accounts : []); setCompanyId(id); setError('') }} onCreateOpen={() => setShowCreate(true)} onManageOpen={() => setShowManage(true)} />}
          <nav className="main-nav" aria-label="Navegação principal">
            {([['overview', 'Visão Geral'], ['orders', 'Pedidos'], ['accounts', 'Contas']] as [Page, string][]).map(([id, label]) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>{label}</button>)}
          </nav>
          <UserMenu user={user} mode={themeMode} onSetMode={setThemeMode} onAccount={() => setPage('myaccount')} onLogout={handleLogout} />
        </header>
        {demo && <div className="demo-banner" role="status">Demonstração · Dados fictícios de 2025 · Alterações não são salvas no servidor.<button onClick={handleLogout}>Sair da demonstração</button></div>}
        <main className="app-content">
          {connectionMessage && <div className="app-alert" role="status">{connectionMessage}</div>}
          {error && <div className="app-alert" role="alert">{error} <button style={btnSec} onClick={() => setReloadKey(key => key + 1)}>Tentar novamente</button></div>}
          {loading ? <Spinner /> : companyError ? <div className="app-alert" role="alert">{companyError} <button style={btnSec} onClick={() => setReloadKey(key => key + 1)}>Tentar novamente</button></div> : page === 'myaccount' ? <MyAccountPage /> : !company ? <OnboardingPage user={user} onCreate={addCompany} /> : page === 'overview' ? <Overview dataReady={demo || accounts.some(account => account.companyId === company.id && account.lastSync !== null)} accountsLoading={!demo && (accountRequest.companyId !== company.id || accountRequest.status === 'loading')} accountsError={!demo && accountRequest.companyId === company.id && accountRequest.status === 'error'} key={company.id} companyId={company.id} accounts={accounts} orders={demo ? ALL_ORDERS : orders.filter(order => order.companyId === company.id)} onAccounts={() => setPage('accounts')} /> : page === 'orders' ? <OrdersPage key={company.id} companyId={company.id} accounts={accounts} orders={demo ? ALL_ORDERS : orders.filter(order => order.companyId === company.id)} /> : <AccountsPage key={company.id} canEdit={company.canEdit} companyId={company.id} accounts={accounts} setAccounts={setAccounts} onSynced={() => setReloadKey(key => key + 1)} />}
        </main>
      </div>
      {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} onCreate={addCompany} />}
      {showManage && <ManageCompaniesModal companies={companies} accounts={accounts} onClose={() => setShowManage(false)} onUpdate={updateCompany} onCreateOpen={() => { setShowManage(false); setShowCreate(true) }} />}
    </AuthContext.Provider>}
  </ThemeContext.Provider>
}
