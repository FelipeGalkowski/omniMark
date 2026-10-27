import { Icon } from './Icon'
import { api } from "./api"
import { useEffect, useRef, useState } from "react"
import { useAuth } from "./auth"
import { DEMO_NOW, MARKETPLACES, formatDateTime, type Account, type MarketplaceId } from "./data"
import { EmptyState, SandboxNotice, btnPri, btnSec } from "./ui"

const ACCT_STATUS = {
  pending: { label:"Aguardando conexão", bg:"#F1F5F9", color:"#475569", dot:"#94A3B8" },
  connected:        { label:"Conectada",            bg:"#DCFCE7", color:"#166534", dot:"#22C55E" },
  syncing:          { label:"Sincronizando…",       bg:"#DBEAFE", color:"#1E40AF", dot:"#3B82F6" },
  error:            { label:"Erro",                 bg:"#FEE2E2", color:"#991B1B", dot:"#EF4444" },
  reconnect_needed: { label:"Reconexão necessária", bg:"#FEF3C7", color:"#92400E", dot:"#F59E0B" },
}

interface AccountsPageProps {
  companyId: string
  accounts: Account[]
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>
  canEdit?: boolean
  onDisconnected?: (accountId: string) => void
}

export default function AccountsPage({ companyId, accounts, setAccounts, canEdit = true, onDisconnected }: AccountsPageProps) {
  const { user } = useAuth()
  const demo = user.isDemoUser
  const companyAccounts = accounts.filter(a => a.companyId === companyId)
  const [connectOpen, setConnectOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Account | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<Account | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const disconnectBusy = useRef(false)
  const [syncing,     setSyncing]     = useState<Set<string>>(new Set())
  const [feedback,    setFeedback]    = useState<Record<string, { ok: boolean; msg: string }>>({})

  async function disconnect() {
    if (!disconnectTarget || disconnectBusy.current || (!demo && !canEdit)) return
    const target = disconnectTarget
    disconnectBusy.current = true
    setDisconnecting(true); setDisconnectError('')
    try {
      if (!demo) await api(`/companies/${companyId}/accounts/${target.id}`, { method: 'DELETE' })
      setAccounts(previous => previous.filter(account => account.id !== target.id))
      setDisconnectTarget(null)
      onDisconnected?.(target.id)
    } catch (error) {
      setDisconnectError((error as Error).message)
    } finally {
      disconnectBusy.current = false
      setDisconnecting(false)
    }
  }

  async function renameAccount(name: string) {
    if (!renameTarget || (!demo && !canEdit)) throw new Error('Sem permissão para renomear esta conta.')
    const target = renameTarget
    const result = demo ? { name } : await api<{ name: string }>(`/companies/${companyId}/accounts/${target.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    setAccounts(previous => previous.map(account => account.id === target.id && account.companyId === companyId ? { ...account, name: result.name } : account))
    setRenameTarget(null)
  }

  function triggerReconnect(id: string) {
    if (!demo || syncing.has(id)) return
    setSyncing(s => new Set([...s, id]))
    setFeedback(f => { const n = {...f}; delete n[id]; return n })
    setTimeout(() => {
      setSyncing(s => { const n = new Set(s); n.delete(id); return n })
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, status:"connected" as const, lastSync: new Date(DEMO_NOW), errorMsg: undefined } : a))
      setFeedback(f => ({ ...f, [id]: { ok: true, msg: "Conta reconectada com sucesso!" } }))
      setTimeout(() => setFeedback(f => { const n={...f}; delete n[id]; return n }), 3500)
    }, 2500)
  }

  function addAccount(marketplace: MarketplaceId, name: string) {
    if (!demo) return
    setAccounts(prev => [...prev, {
      id: `new-${Date.now()}`,
      companyId,
      marketplace,
      name,
      status: "connected",
      lastSync: new Date(DEMO_NOW),
    }])
    setConnectOpen(false)
  }

  return (
    <div className="page-body" style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:20 }}>
      <SandboxNotice accounts={companyAccounts} />
      <div style={{ background:"var(--sf3)", border:"1px solid var(--bd)", borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
        <Icon name="info" />
        <span style={{ fontSize:12, color:"var(--t2)" }}>
          {demo ? <><strong>Demonstração:</strong> as conexões aqui são fictícias. As ações simulam uma integração e não acessam os marketplaces.</> : <><strong>Atualização automática.</strong> A primeira importação começa após conectar a loja. As próximas atualizações acontecem em segundo plano, mesmo com o painel fechado. Informações indisponíveis serão identificadas no painel.</>}
        </span>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:700, letterSpacing:"-0.02em", color:"var(--t1)" }}>Contas e Integrações</h1>
          <p style={{ margin:"4px 0 0", fontSize:13, color:"var(--t3)" }}>{companyAccounts.length} conta{companyAccounts.length!==1?"s":""} configurada{companyAccounts.length!==1?"s":""}</p>
        </div>
        <button aria-label="Conectar nova conta" disabled={!demo && !canEdit} onClick={() => setConnectOpen(true)} style={btnPri}><Icon name="plus" /> Conectar conta</button>
      </div>

      {companyAccounts.length === 0 ? (
        <EmptyState
          icon="plug"
          title="Nenhuma conta conectada"
          desc="Conecte sua primeira conta de marketplace para começar a consolidar as vendas."
          action={<button disabled={!demo && !canEdit} onClick={() => setConnectOpen(true)} style={btnPri}>Conectar conta</button>}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {companyAccounts.map(acct => {
            const mkt       = MARKETPLACES.find(m => m.id === acct.marketplace)!
            const isSyncing = syncing.has(acct.id) || acct.synchronization?.state === 'running'
            const supported = demo || (acct.synchronization?.supported ?? acct.marketplace === 'mercadolivre')
            const status    = isSyncing ? "syncing" : acct.status
            const cfg       = ACCT_STATUS[status]
            const fb        = feedback[acct.id]

            return (
              <div className="account-card" key={acct.id} style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:14, padding:"18px 22px", display:"flex", alignItems:"flex-start", gap:16 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:mkt.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`1.5px solid ${mkt.color}` }}>
                  <Icon name="store" size={20} style={{ color:mkt.text }} />
                </div>

                <div className="account-content" style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontWeight:700, fontSize:15, color:"var(--t1)", overflowWrap:'anywhere' }}>{acct.name}</span>
                    {acct.active === false ? <span style={{ fontSize:11, color:'var(--t3)' }}>Outro ambiente</span> : <AcctStatusBadge status={status} />}
                    {acct.environment === 'SANDBOX' && <span style={{ fontSize:11, fontWeight:700, color:'#1D4ED8', background:'#DBEAFE', borderRadius:20, padding:'3px 8px' }}>Sandbox · dados fictícios</span>}
                  </div>
                  <div style={{ fontSize:12, color:"var(--t3)", marginTop:3 }}>{mkt.label}</div>
                  {!demo && <p style={{ fontSize:12, color:'var(--t3)', margin:'8px 0 0' }}>
                    {acct.active === false ? 'Conta de outro ambiente do marketplace. Seus dados não entram nos pedidos e indicadores atuais.'
                      : !supported ? 'A importação deste marketplace ainda não está disponível.'
                      : acct.synchronization?.state === 'disabled' ? 'A atualização automática está pausada no servidor.'
                      : acct.synchronization?.state === 'reconnect_needed' ? 'Reconecte a loja para retomar as atualizações automáticas.'
                      : acct.synchronization?.state === 'running' ? 'Importando os dados em segundo plano…'
                      : acct.synchronization?.state === 'scheduled' ? 'Aguardando a próxima importação automática…'
                      : `Atualização automática a cada ${acct.synchronization?.intervalMinutes ?? 5} minutos.`}
                    {supported && acct.synchronization?.enabled && acct.synchronization.nextAt && !isSyncing && <> {acct.errorMsg ? 'Próxima tentativa' : 'Próxima atualização'}: {formatDateTime(new Date(acct.synchronization.nextAt))}.</>}
                  </p>}

                  {acct.active !== false && acct.errorMsg && (
                    <div style={{ marginTop:8, background: acct.status==="error"?"#FEE2E2":"#FEF3C7", border:`1px solid ${acct.status==="error"?"#FCA5A5":"#FCD34D"}`, borderRadius:8, padding:"8px 12px", fontSize:12, color: acct.status==="error"?"#991B1B":"#92400E" }}>
                      {acct.errorMsg}
                    </div>
                  )}

                  {fb && (
                    <div style={{ marginTop:8, background:fb.ok?"#DCFCE7":"#FEE2E2", border:`1px solid ${fb.ok?"#86EFAC":"#FCA5A5"}`, borderRadius:8, padding:"8px 12px", fontSize:12, color:fb.ok?"#166534":"#991B1B" }}>
                      <Icon name={fb.ok ? "check" : "alert"} /> {fb.msg}
                    </div>
                  )}

                  <div style={{ fontSize:11, color:"var(--t4)", marginTop:8 }}>
                    {isSyncing ? "Atualizando dados…" : `Última atualização: ${formatDateTime(acct.lastSync)}`}
                  </div>
                </div>

                <div className="account-actions" style={{ display:"flex", gap:8, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
                  {(demo || canEdit) && <button
                    aria-label={`Desconectar ${acct.name}`}
                    title="Desconectar conta"
                    disabled={isSyncing || disconnecting}
                    onClick={() => { setDisconnectError(''); setDisconnectTarget(acct) }}
                    style={{ ...btnSec, padding:'7px', color:'var(--t3)', opacity:isSyncing ? 0.5 : 1 }}
                  ><Icon name="trash" size={18} /></button>}
                  {acct.active !== false && acct.status === "reconnect_needed" && !isSyncing && (
                    <button disabled={!demo && (!canEdit || !['mercadolivre', 'magalu', 'shopee'].includes(acct.marketplace))} onClick={() => demo ? triggerReconnect(acct.id) : setConnectOpen(true)} style={{ ...btnPri, fontSize:12, padding:"6px 14px", background:"#EF4444" }}>
                      Reconectar
                    </button>
                  )}
                  {(demo || canEdit) && (
                    <button
                      aria-label={`Renomear ${acct.name}`}
                      onClick={() => setRenameTarget(acct)}
                      style={{ ...btnSec, fontSize:12, padding:"6px 14px" }}
                    >
                      Renomear
                    </button>
                  )}
                  {acct.status === "reconnect_needed" && isSyncing && (
                    <button disabled style={{ ...btnSec, fontSize:12, padding:"6px 14px", opacity:0.5, cursor:"not-allowed" }}>
                      Reconectando…
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {connectOpen && <ConnectModal companyId={companyId} demo={demo} onClose={() => setConnectOpen(false)} onConnect={addAccount} />}
      {renameTarget && <RenameModal key={renameTarget.id} account={renameTarget} onClose={() => setRenameTarget(null)} onSave={renameAccount} />}
      {disconnectTarget && <DisconnectModal account={disconnectTarget} busy={disconnecting} error={disconnectError}
        onClose={() => { if (!disconnectBusy.current) setDisconnectTarget(null) }} onConfirm={disconnect} />}
    </div>
  )
}

function RenameModal({ account, onClose, onSave }: { account: Account; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(account.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const dialog = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus(); input.current?.select()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving.current) return
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 120 || /[\p{Cc}\p{Cf}]/u.test(trimmed)) { setError('Informe um nome de 1 a 120 caracteres, sem caracteres de controle.'); return }
    if (trimmed === account.name) { onClose(); return }
    saving.current = true; setBusy(true); setError('')
    try { await onSave(trimmed) }
    catch (failure) { setError((failure as Error).message) }
    finally { saving.current = false; setBusy(false) }
  }

  return <div style={{ position:'fixed', inset:0, zIndex:60, background:'rgba(0,0,0,0.35)', display:'grid', gridTemplateColumns:'minmax(0,1fr)', placeItems:'center', padding:16 }}>
    <form ref={dialog} role="dialog" aria-modal="true" aria-labelledby="rename-title" aria-describedby="rename-description" aria-busy={busy} onSubmit={save}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); if (!saving.current) onClose() }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])
          const first = controls[0], last = controls[controls.length - 1]
          if (!first) { event.preventDefault(); return }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
      }}
      style={{ width:440, maxWidth:'100%', boxSizing:'border-box', background:'var(--sf)', border:'1px solid var(--bd)', borderRadius:14, padding:24, boxShadow:'0 16px 48px var(--shd2)' }}>
      <h2 id="rename-title" style={{ margin:'0 0 12px', fontSize:18, color:'var(--t1)' }}>Renomear conta</h2>
      <p id="rename-description" style={{ fontSize:13, lineHeight:1.6, color:'var(--t2)' }}>Escolha um nome para identificar esta loja no OmniMark.</p>
      <label htmlFor="account-name" style={{ display:'block', marginBottom:6, fontSize:12, fontWeight:600, color:'var(--t2)' }}>Nome da conta</label>
      <input ref={input} id="account-name" value={name} maxLength={120} disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'rename-error' : undefined}
        onChange={event => { setName(event.target.value); setError('') }}
        style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px', borderRadius:8, border:'1px solid var(--bd)', background:'var(--inp)', color:'var(--t1)', font:'inherit', fontSize:13 }} />
      {error && <p id="rename-error" role="alert" style={{ fontSize:13, color:'#DC2626' }}>{error}</p>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
        <button type="button" disabled={busy} style={btnSec} onClick={() => { if (!saving.current) onClose() }}>Cancelar</button>
        <button type="submit" disabled={busy} style={btnPri}>{busy ? 'Salvando…' : 'Salvar nome'}</button>
      </div>
    </form>
  </div>
}

function DisconnectModal({ account, busy, error, onClose, onConfirm }: {
  account: Account; busy: boolean; error: string; onClose: () => void; onConfirm: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div style={{ position:'fixed', inset:0, zIndex:60, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', padding:16 }}>
    <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" aria-describedby="disconnect-description" aria-busy={busy}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose() }
        if (event.key === 'Tab') {
          const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
          const first = buttons[0], last = buttons[buttons.length - 1]
          if (!first) { event.preventDefault(); return }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
      }}
      style={{ width:440, maxWidth:'100%', background:'var(--sf)', border:'1px solid var(--bd)', borderRadius:14, padding:24, boxShadow:'0 16px 48px var(--shd2)' }}>
      <h2 id="disconnect-title" style={{ margin:'0 0 12px', fontSize:18, color:'var(--t1)' }}>Desconectar conta?</h2>
      <p id="disconnect-description" style={{ fontSize:13, lineHeight:1.6, color:'var(--t2)', overflowWrap:'anywhere' }}>
        A conta <strong>{account.name}</strong> e seus pedidos importados serão removidos do OmniMark.
        Sua conta e seus pedidos no marketplace não serão alterados. Para voltar a importar, conecte a conta novamente.
      </p>
      {error && <p role="alert" style={{ fontSize:13, color:'#DC2626' }}>{error}</p>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
        <button ref={cancel} disabled={busy} style={btnSec} onClick={onClose}>Cancelar</button>
        <button disabled={busy} style={{ ...btnPri, background:'#B91C1C' }} onClick={onConfirm}>
          {busy ? 'Desconectando…' : 'Desconectar conta'}
        </button>
      </div>
    </div>
  </div>
}


function AcctStatusBadge({ status }: { status: keyof typeof ACCT_STATUS }) {
  const cfg = ACCT_STATUS[status]
  return (
    <span style={{ background:cfg.bg, color:cfg.color, fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:20, display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:cfg.dot }} />
      {cfg.label}
    </span>
  )
}


type ConnectStep = "choose" | "name" | "connecting" | "done"

function ConnectModal({ onClose, onConnect, demo, companyId }: { companyId: string; demo: boolean; onClose: () => void; onConnect: (mkt: MarketplaceId, name: string) => void }) {
  const [step,   setStep]   = useState<ConnectStep>("choose")
  const [selMkt, setSelMkt] = useState<MarketplaceId | null>(null)
  const [name,   setName]   = useState("")
  const [error,  setError]  = useState("")
  const [integrationEnvironment, setIntegrationEnvironment] = useState<'PRODUCTION' | 'SANDBOX' | null>(null)
  useEffect(() => {
    if (demo || !['magalu', 'shopee'].includes(selMkt ?? '') || step !== 'name') return
    const controller = new AbortController()
    setIntegrationEnvironment(null)
    api<{ environment: 'PRODUCTION' | 'SANDBOX' }>(`/integrations/${selMkt}/environment`, { signal: controller.signal })
      .then(result => setIntegrationEnvironment(result.environment))
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [demo, selMkt, step])

  const [busy, setBusy] = useState(false)
  async function authorize() {
    if ((selMkt === 'magalu' || selMkt === 'shopee') && !integrationEnvironment) return
    setBusy(true); setError("")
    try {
      if (selMkt !== 'mercadolivre' && selMkt !== 'magalu' && selMkt !== 'shopee') return
      const result = await api<{ url: string }>(`/companies/${companyId}/integrations/${selMkt}/authorize`, { method: "POST", body: "{}" })
      window.location.assign(result.url)
    } catch (failure) { setError((failure as Error).message); setBusy(false) }
  }

  function handleChoose(id: MarketplaceId) {
    setSelMkt(id)
    setName(MARKETPLACES.find(m => m.id === id)!.label)
    setStep("name")
  }

  function handleConnect() {
    if (!demo) return
    if (!name.trim()) { setError("Informe um nome para a conta."); return }
    setError("")
    setStep("connecting")
    setTimeout(() => setStep("done"), 2000)
  }

  function handleFinish() {
    if (selMkt) onConnect(selMkt, name.trim())
  }

  const mkt = selMkt ? MARKETPLACES.find(m => m.id === selMkt)! : null

  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.25)", zIndex:40 }} />
      <div style={{ position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:"var(--sf)", borderRadius:16, boxShadow:`0 16px 48px var(--shd2)`, zIndex:50, width:440, maxWidth:"calc(100vw - 32px)", overflow:"hidden" }}>
        <div style={{ padding:"20px 24px 0", display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:"var(--t1)" }}>
            {step==="choose" && "Conectar conta"}
            {step==="name" && (demo ? "Nome da conta" : selMkt === "mercadolivre" ? "Autorizar Mercado Livre" : selMkt === 'shopee' ? 'Autorizar Shopee' : selMkt === 'magalu' ? 'Autorizar Magalu' : "Integração em preparação")}
            {step==="connecting" && "Conectando…"}
            {step==="done"   && "Conta conectada!"}
          </h2>
          <button aria-label="Fechar janela" onClick={onClose} style={{ width:28, height:28, borderRadius:7, border:"1.5px solid var(--bd)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--t3)" }}>
            <Icon name="close" />
          </button>
        </div>

        <div style={{ padding:"0 24px 24px" }}>
          {step === "choose" && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <p style={{ margin:"0 0 8px", fontSize:13, color:"var(--t3)" }}>Selecione o marketplace que deseja integrar:</p>
              {MARKETPLACES.map(m => (
                <button key={m.id} onClick={() => handleChoose(m.id)} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", borderRadius:12, border:"1.5px solid var(--bd)", background:"var(--sf)", cursor:"pointer", textAlign:"left", transition:"border-color 0.15s", fontFamily:"'DM Sans',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor=m.color}
                  onMouseLeave={e => e.currentTarget.style.borderColor="var(--bd)"}
                >
                  <span style={{ width:32, height:32, borderRadius:8, background:m.bg, border:`2px solid ${m.color}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Icon name="store" size={18} style={{ color:m.text }} />
                  </span>
                  <span style={{ fontSize:14, fontWeight:600, color:"var(--t1)" }}>{m.label}</span>
                </button>
              ))}
            </div>
          )}

          {!demo && step === "name" && mkt && <div className="stack-form"><h3>{mkt.label}</h3>{selMkt === 'mercadolivre' || selMkt === 'magalu' || selMkt === 'shopee' ? <>
            <p>Você será encaminhado ao {mkt.label} para autorizar o acesso à sua conta.</p>
            <p>A importação começa automaticamente após a autorização e continua em segundo plano.</p>
            {selMkt === 'magalu' && <>{integrationEnvironment === 'SANDBOX' ? <><p><strong>Sandbox Magalu · dados fictícios.</strong> Você pode usar seu ID pessoal. A conexão prepara um vendedor fictício para testar pedidos.</p><p>Solicitamos leitura de pedidos e permissões de catálogo para criar o produto de teste.</p></> : <p>{integrationEnvironment ? 'Selecione a organização da sua loja vendedora no ID Magalu. Solicitamos leitura de pedidos e entregas.' : 'Consultando o ambiente da integração…'}</p>}<p><a href="/termos" target="_blank" rel="noreferrer">Termos de uso</a> · <a href="/privacidade" target="_blank" rel="noreferrer">Privacidade</a></p></>}
            {selMkt === 'shopee' && <p>{integrationEnvironment === 'SANDBOX' ? 'Sandbox Shopee · dados fictícios. Autorize uma loja de teste brasileira por vez.' : integrationEnvironment ? 'Autorize uma loja brasileira por vez. Os dados disponíveis serão importados automaticamente.' : 'Consultando o ambiente da integração…'}</p>}
            {error && <p role="alert">{error}</p>}
            <button disabled={busy || ((selMkt === 'magalu' || selMkt === 'shopee') && !integrationEnvironment)} style={btnPri} onClick={authorize}>{busy ? 'Abrindo autorização…' : selMkt === 'shopee' ? 'Autorizar na Shopee' : selMkt === 'magalu' ? 'Autorizar com o ID Magalu' : 'Autorizar no Mercado Livre'}</button>
          </> : <p>A integração com este marketplace ainda está em desenvolvimento.</p>}<button style={btnSec} onClick={onClose}>Fechar</button></div>}
          {demo && step === "name" && mkt && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:mkt.bg, borderRadius:10 }}>
                <Icon name="store" size={24} style={{ color:mkt.text }} />
                <span style={{ fontSize:13, fontWeight:600, color:mkt.text }}>{mkt.label}</span>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:"var(--t2)", display:"block", marginBottom:6 }}>Nome da conta</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={`Ex: ${mkt.label} Loja Principal`}
                  style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:`1.5px solid ${error?"#EF4444":"var(--bd)"}`, fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:"none", color:"var(--t1)", background:"var(--inp)" }}
                  autoFocus
                />
                {error && <span style={{ fontSize:11, color:"#EF4444", marginTop:4, display:"block" }}>{error}</span>}
                <p style={{ fontSize:11, color:"var(--t3)", marginTop:6 }}>Dê um nome que ajude a identificar esta conta dentro do Omnimark.</p>
              </div>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => setStep("choose")} style={btnSec}>Voltar</button>
                <button onClick={handleConnect} style={btnPri}>Conectar</button>
              </div>
            </div>
          )}

          {step === "connecting" && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"24px 0" }}>
              <Icon name="loader" size={32} className="icon-spin" style={{ color:"var(--t3)" }} />
              <div style={{ textAlign:"center" }}>
                <div style={{ fontWeight:600, fontSize:14, color:"var(--t1)" }}>Estabelecendo conexão…</div>
                <div style={{ fontSize:12, color:"var(--t3)", marginTop:4 }}>Isso é uma demonstração — nenhuma credencial real é necessária.</div>
              </div>
            </div>
          )}

          {step === "done" && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"24px 0" }}>
              <div style={{ width:48, height:48, borderRadius:"50%", background:"#DCFCE7", display:"flex", alignItems:"center", justifyContent:"center", color:"#166534" }}><Icon name="check" size={24} /></div>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontWeight:700, fontSize:15, color:"var(--t1)" }}>Conta conectada!</div>
                <div style={{ fontSize:12, color:"var(--t3)", marginTop:4 }}>
                  <strong>{name}</strong> foi adicionada com sucesso.
                </div>
              </div>
              <button onClick={handleFinish} style={btnPri}>Concluir</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
