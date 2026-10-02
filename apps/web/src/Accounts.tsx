import { Icon } from './Icon'
import { api } from "./api"
import { useEffect, useRef, useState } from "react"
import { useAuth } from "./auth"
import { DEMO_NOW, MARKETPLACES, formatDateTime, type Account, type MarketplaceId } from "./data"
import { EmptyState, btnPri, btnSec } from "./ui"

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
  onSynced?: () => void
  onDisconnected?: (accountId: string) => void
}

export default function AccountsPage({ companyId, accounts, setAccounts, canEdit = true, onSynced, onDisconnected }: AccountsPageProps) {
  const { user } = useAuth()
  const demo = user.isDemoUser
  const companyAccounts = accounts.filter(a => a.companyId === companyId)
  const [connectOpen, setConnectOpen] = useState(false)
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

  async function triggerUpdate(id: string) {
    if (syncing.has(id) || (!demo && !canEdit)) return
    setSyncing(s => new Set([...s, id]))
    setFeedback(f => { const n = {...f}; delete n[id]; return n })
    if (!demo) {
      try {
        const result = await api<{ orders: number; incomplete: number }>(`/companies/${companyId}/accounts/${id}/sync`, { method: 'POST', body: '{}' })
        setFeedback(f => ({ ...f, [id]: { ok: true, msg: `${result.orders} pedidos sincronizados.${result.incomplete ? ` ${result.incomplete} com dados financeiros incompletos.` : ''}` } }))
      } catch (error) {
        setFeedback(f => ({ ...f, [id]: { ok: false, msg: (error as Error).message } }))
      } finally {
        setSyncing(s => { const next = new Set(s); next.delete(id); return next })
        onSynced?.()
      }
      return
    }
    setTimeout(() => {
      setSyncing(s => { const n = new Set(s); n.delete(id); return n })
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, status:"connected" as const, lastSync: new Date(DEMO_NOW) } : a))
      setFeedback(f => ({ ...f, [id]: { ok: true, msg: "Dados atualizados com sucesso!" } }))
      setTimeout(() => setFeedback(f => { const n={...f}; delete n[id]; return n }), 3500)
    }, 2500)
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
      <div style={{ background:"var(--sf3)", border:"1px solid var(--bd)", borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
        <Icon name="info" />
        <span style={{ fontSize:12, color:"var(--t2)" }}>
          {demo ? <><strong>Demonstração:</strong> as conexões aqui são fictícias. As ações simulam uma integração e não acessam os marketplaces.</> : <><strong>Mercado Livre.</strong> Atualize os dados para consultar os pedidos dos últimos 12 meses. Informações indisponíveis serão identificadas no painel.</>}
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
            const isSyncing = syncing.has(acct.id)
            const status    = isSyncing ? "syncing" : acct.status
            const cfg       = ACCT_STATUS[status]
            const fb        = feedback[acct.id]

            return (
              <div key={acct.id} style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:14, padding:"18px 22px", display:"flex", alignItems:"flex-start", gap:16 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:mkt.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`1.5px solid ${mkt.color}` }}>
                  <Icon name="store" size={20} style={{ color:mkt.text }} />
                </div>

                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontWeight:700, fontSize:15, color:"var(--t1)" }}>{acct.name}</span>
                    <AcctStatusBadge status={status} />
                  </div>
                  <div style={{ fontSize:12, color:"var(--t3)", marginTop:3 }}>{mkt.label}</div>

                  {acct.errorMsg && (
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

                <div style={{ display:"flex", gap:8, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
                  {(demo || canEdit) && <button
                    aria-label={`Desconectar ${acct.name}`}
                    title="Desconectar conta"
                    disabled={isSyncing || disconnecting}
                    onClick={() => { setDisconnectError(''); setDisconnectTarget(acct) }}
                    style={{ ...btnSec, padding:'7px', color:'var(--t3)', opacity:isSyncing ? 0.5 : 1 }}
                  ><Icon name="trash" size={18} /></button>}
                  {acct.status === "reconnect_needed" && !isSyncing && (
                    <button disabled={!demo && (!canEdit || acct.marketplace !== "mercadolivre")} onClick={() => demo ? triggerReconnect(acct.id) : setConnectOpen(true)} style={{ ...btnPri, fontSize:12, padding:"6px 14px", background:"#EF4444" }}>
                      Reconectar
                    </button>
                  )}
                  {acct.status !== "reconnect_needed" && (
                    <button
                      onClick={() => triggerUpdate(acct.id)}
                      disabled={isSyncing || (!demo && (!canEdit || acct.marketplace !== 'mercadolivre'))}
                      style={{ ...btnSec, fontSize:12, padding:"6px 14px", opacity:isSyncing?0.5:1, cursor:isSyncing?"not-allowed":"pointer" }}
                    >
                      {isSyncing ? "Atualizando…" : "Atualizar dados"}
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
      {disconnectTarget && <DisconnectModal account={disconnectTarget} busy={disconnecting} error={disconnectError}
        onClose={() => { if (!disconnectBusy.current) setDisconnectTarget(null) }} onConfirm={disconnect} />}
    </div>
  )
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

  const [busy, setBusy] = useState(false)
  async function authorize() {
    setBusy(true); setError("")
    try {
      const result = await api<{ url: string }>(`/companies/${companyId}/integrations/mercadolivre/authorize`, { method: "POST", body: "{}" })
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
            {step==="name" && (demo ? "Nome da conta" : selMkt === "mercadolivre" ? "Autorizar Mercado Livre" : "Integração em preparação")}
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

          {!demo && step === "name" && mkt && <div className="stack-form"><h3>{mkt.label}</h3>{selMkt === 'mercadolivre' ? <><p>Você será encaminhado ao Mercado Livre para autorizar o acesso à sua conta.</p>{error && <p role="alert">{error}</p>}<button disabled={busy} style={btnPri} onClick={authorize}>{busy ? 'Abrindo autorização…' : 'Autorizar no Mercado Livre'}</button></> : <p>A integração com este marketplace ainda está em desenvolvimento.</p>}<button style={btnSec} onClick={onClose}>Fechar</button></div>}
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
