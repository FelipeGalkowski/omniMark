import { Icon, type IconName } from './Icon'
import { useEffect, useRef, useState } from 'react'
import { formatCNPJ, validateCNPJ, type Company, type Account } from './data'
import { type ThemeMode } from './theme'
import { type User } from './auth'
import { ChevronIcon } from './ui'
const isDemo = (user: User) => user.isDemoUser

export function UserMenu({ user, mode, onSetMode, onAccount, onLogout }: {
  user: User; mode: ThemeMode; onSetMode: (m: ThemeMode) => void; onAccount: () => void; onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  const initials = user.name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("")

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px 4px 4px", borderRadius:20, border:"1.5px solid var(--bd)", background:"transparent", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
        <div style={{ width:26, height:26, borderRadius:"50%", background:"var(--t1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <span style={{ fontSize:10, fontWeight:700, color:"var(--sf)" }}>{initials || "?"}</span>
        </div>
        <span style={{ fontSize:13, fontWeight:600, color:"var(--t1)", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:12, boxShadow:`0 8px 24px var(--shd2)`, padding:"8px 0", minWidth:224, zIndex:200 }}>
          <div style={{ padding:"10px 16px 12px", borderBottom:"1px solid var(--bd)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--t1)" }}>{user.name}</div>
            <div style={{ fontSize:11, color:"var(--t3)", marginTop:2 }}>{user.email}</div>
            {isDemo(user) && (
              <span style={{ fontSize:10, fontWeight:600, color:"#92400E", background:"#FEF3C7", borderRadius:4, padding:"2px 6px", marginTop:5, display:"inline-block" }}>Demonstração</span>
            )}
          </div>

          <MenuBtn onClick={() => { onAccount(); setOpen(false) }}>
            <Icon name="user" /> Minha conta
          </MenuBtn>

          <div style={{ padding:"10px 16px", borderTop:"1px solid var(--bd)", borderBottom:"1px solid var(--bd)" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Tema</div>
            <div style={{ display:"flex", border:"1.5px solid var(--bd)", borderRadius:8, overflow:"hidden" }}>
              {([["light","sun","Claro"],["dark","moon","Escuro"],["system","monitor","Sistema"]] as [ThemeMode,IconName,string][]).map(([m, icon, label], i) => (
                <button key={m} onClick={() => onSetMode(m)} title={label} aria-label={label} aria-pressed={mode === m} style={{ flex:1, padding:"5px 0", border:"none", borderLeft: i>0?"1px solid var(--bd)":"none", background: mode===m ? "var(--t1)" : "transparent", color: mode===m ? "var(--sf)" : "var(--t3)", cursor:"pointer", fontSize:13, lineHeight:1, transition:"background 0.12s" }}>
                  <Icon name={icon} />
                </button>
              ))}
            </div>
          </div>

          <MenuBtn onClick={() => { onLogout(); setOpen(false) }} danger>
            <Icon name="logout" /> Sair
          </MenuBtn>
        </div>
      )}
    </div>
  )
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:500, color: danger ? "#EF4444" : "var(--t2)", textAlign:"left", fontFamily:"'DM Sans',sans-serif" }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--hover)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      {children}
    </button>
  )
}


export function CompanySelector({ company, companies, accounts, onSwitch, onCreateOpen, onManageOpen }: {
  company: Company; companies: Company[]; accounts: Account[];
  onSwitch: (id: string) => void; onCreateOpen: () => void; onManageOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 12px", borderRadius:8, border:"1.5px solid var(--bd)", background:"var(--sf)", fontSize:13, fontWeight:600, color:"var(--t1)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
        <Icon name="building" />
        <span style={{ maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{company.name}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:10, boxShadow:`0 8px 24px var(--shd)`, padding:"6px 0", minWidth:220, zIndex:200 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.06em", padding:"4px 14px 8px" }}>Empresa</div>
          {companies.map(c => (
            <button key={c.id} onClick={() => { onSwitch(c.id); setOpen(false) }} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 14px", border:"none", background: c.id===company.id ? "var(--sf3)" : "transparent", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", gap:8 }}
              onMouseEnter={e => { if (c.id !== company.id) e.currentTarget.style.background = "var(--hover)" }}
              onMouseLeave={e => { if (c.id !== company.id) e.currentTarget.style.background = "transparent" }}
            >
              <div style={{ textAlign:"left", minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</div>
                {c.cnpj && <div style={{ fontSize:11, color:"var(--t3)" }}>{c.cnpj}</div>}
              </div>
              {c.id === company.id && <Icon name="check" style={{ color:"var(--t3)" }} />}
            </button>
          ))}
          <div style={{ borderTop:"1px solid var(--bd)", marginTop:6, paddingTop:6 }}>
            <button onClick={() => { onCreateOpen(); setOpen(false) }} style={{ width:"100%", padding:"8px 14px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:500, color:"var(--t2)", textAlign:"left", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:8 }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--hover)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <Icon name="plus" /> Cadastrar empresa
            </button>
            <button onClick={() => { onManageOpen(); setOpen(false) }} style={{ width:"100%", padding:"8px 14px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:500, color:"var(--t2)", textAlign:"left", fontFamily:"'DM Sans',sans-serif" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--hover)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              Gerenciar empresas
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


export function CreateCompanyModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Omit<Company, 'id'>) => Promise<void> }) {
  const [name,        setName]        = useState("")
  const [razaoSocial, setRazaoSocial] = useState("")
  const [cnpj,        setCnpj]        = useState("")
  const [errors,      setErrors]      = useState<Record<string, string>>({})
  const [done,        setDone]        = useState(false)
  const [doneLabel,   setDoneLabel]   = useState("")

  async function handleSubmit() {
    if (done) return
    const errs: Record<string, string> = {}
    if (name.trim().length < 2 || name.trim().length > 120) errs.name = "Informe um nome entre 2 e 120 caracteres."
    if (cnpj && !validateCNPJ(cnpj)) errs.cnpj = "CNPJ inválido. Use o formato XX.XXX.XXX/XXXX-XX."
    if (Object.keys(errs).length) { setErrors(errs); return }
    setDoneLabel(name.trim()); setDone(true); setErrors({})
    try { await onCreate({ name: name.trim(), razaoSocial: razaoSocial.trim() || undefined, cnpj: cnpj || undefined }) }
    catch (error) { setErrors({ form: (error as Error).message }); setDone(false) }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader title={done ? "Cadastrando empresa…" : "Cadastrar empresa"} onClose={onClose} />
      <div style={{ padding:"20px 24px 24px" }}>
        {done ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14, padding:"16px 0" }}>
            <div style={{ width:48, height:48, borderRadius:"50%", background:"var(--sf3)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--t3)" }}><Icon name="loader" size={24} className="icon-spin" /></div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontWeight:700, fontSize:15, color:"var(--t1)" }}>{doneLabel}</div>
              <div style={{ fontSize:13, color:"var(--t3)", marginTop:4 }}>Salvando os dados da empresa…</div>
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
            <MField label="Nome de exibição *" error={errors.name}>
              <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({...p,name:""})) }} placeholder="Ex: TechStore Brasil" style={mInputStyle(!!errors.name)} autoFocus />
            </MField>
            <MField label="Razão social">
              <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} placeholder="Opcional" style={mInputStyle(false)} />
            </MField>
            <MField label="CNPJ" error={errors.cnpj}>
              <input value={cnpj} onChange={e => { setCnpj(formatCNPJ(e.target.value)); setErrors(p => ({...p,cnpj:""})) }} placeholder="XX.XXX.XXX/XXXX-XX (opcional)" style={mInputStyle(!!errors.cnpj)} />
            </MField>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
              <button onClick={onClose} style={mBtnSec}>Cancelar</button>
              <button onClick={handleSubmit} style={mBtnPri}>Cadastrar empresa</button>
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}


export function ManageCompaniesModal({ companies, accounts, onClose, onUpdate, onCreateOpen }: {
  companies: Company[]; accounts: Account[]; onClose: () => void; onUpdate: (company: Company) => Promise<void>; onCreateOpen: () => void
}) {
  const [editing, setEditing] = useState<Company | null>(null)
  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalHeader title="Gerenciar empresas" onClose={onClose} />
      <div style={{ padding:"0 24px 24px", display:"flex", flexDirection:"column", gap:10, maxHeight:"60vh", overflow:"auto" }}>
        {editing ? (
          <EditCompanyForm company={editing}
            onSave={async u => { await onUpdate(u); setEditing(null) }}
            onCancel={() => setEditing(null)} />
        ) : (
          <>
            {companies.map(c => {
              const acctCount = c.accountCount ?? accounts.filter(a => a.companyId === c.id).length
              return (
                <div key={c.id} style={{ background:"var(--sf2)", border:"1px solid var(--bd)", borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:"var(--t1)" }}>{c.name}</div>
                    {c.razaoSocial && <div style={{ fontSize:12, color:"var(--t3)", marginTop:2 }}>{c.razaoSocial}</div>}
                    <div style={{ display:"flex", gap:12, marginTop:4, flexWrap:"wrap" }}>
                      {c.cnpj && <span style={{ fontSize:11, color:"var(--t3)", fontFamily:"'JetBrains Mono',monospace" }}>{c.cnpj}</span>}
                      <span style={{ fontSize:11, color:"var(--t3)" }}>{acctCount} conta{acctCount!==1?"s":""} vinculada{acctCount!==1?"s":""}</span>
                    </div>
                  </div>
                  {c.canEdit !== false && <button onClick={() => setEditing({...c})} style={mBtnSec}>Editar</button>}
                </div>
              )
            })}
            <button onClick={onCreateOpen} style={{ ...mBtnPri, alignSelf:"flex-start", marginTop:4 }}><Icon name="plus" /> Cadastrar empresa</button>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

function EditCompanyForm({ company, onSave, onCancel }: { company: Company; onSave: (c: Company) => Promise<void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false)
  const [name,        setName]        = useState(company.name)
  const [razaoSocial, setRazaoSocial] = useState(company.razaoSocial ?? "")
  const [cnpj,        setCnpj]        = useState(company.cnpj ?? "")
  const [errors,      setErrors]      = useState<Record<string, string>>({})

  async function handleSubmit() {
    if (saving) return
    const errs: Record<string, string> = {}
    if (name.trim().length < 2 || name.trim().length > 120) errs.name = "Informe um nome entre 2 e 120 caracteres."
    if (cnpj && !validateCNPJ(cnpj)) errs.cnpj = "CNPJ inválido."
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true); setErrors({})
    try { await onSave({ ...company, name: name.trim(), razaoSocial: razaoSocial.trim() || undefined, cnpj: cnpj || undefined }) }
    catch (error) { setErrors({ form: (error as Error).message }) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ fontSize:13, fontWeight:600, color:"var(--t3)" }}>Editando: {company.name}</div>
      {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      <MField label="Nome de exibição *" error={errors.name}>
        <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({...p,name:""})) }} style={mInputStyle(!!errors.name)} autoFocus />
      </MField>
      <MField label="Razão social">
        <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} style={mInputStyle(false)} placeholder="Opcional" />
      </MField>
      <MField label="CNPJ" error={errors.cnpj}>
        <input value={cnpj} onChange={e => { setCnpj(formatCNPJ(e.target.value)); setErrors(p => ({...p,cnpj:""})) }} style={mInputStyle(!!errors.cnpj)} placeholder="XX.XXX.XXX/XXXX-XX (opcional)" />
      </MField>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={onCancel} style={mBtnSec}>Cancelar</button>
        <button onClick={handleSubmit} disabled={saving} style={mBtnPri}>{saving ? "Salvando…" : "Salvar"}</button>
      </div>
    </div>
  )
}


export function EmptyNoCompany({ onCreateOpen }: { onCreateOpen: () => void }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", padding:"48px 24px", gap:16, textAlign:"center" }}>
      <Icon name="building" size={32} style={{ color:"var(--t3)" }} />
      <div>
        <div style={{ fontWeight:700, fontSize:16, color:"var(--t1)", marginBottom:8 }}>Nenhuma empresa cadastrada</div>
        <div style={{ fontSize:13, color:"var(--t3)", maxWidth:340 }}>Cadastre uma empresa para começar a acompanhar suas vendas.</div>
      </div>
      <button onClick={onCreateOpen} style={{ padding:"10px 20px", borderRadius:8, border:"none", background:"var(--pri)", color:"var(--pri-t)", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
        Cadastrar empresa
      </button>
    </div>
  )
}


function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.3)", zIndex:40 }} />
      <div style={{ position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:"var(--sf)", borderRadius:16, boxShadow:`0 16px 48px var(--shd2)`, zIndex:50, width: wide?540:440, maxWidth:"calc(100vw - 32px)", maxHeight:"calc(100dvh - 48px)", overflow:"auto" }}>
        {children}
      </div>
    </>
  )
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ padding:"20px 24px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:"var(--t1)" }}>{title}</h2>
      <button aria-label="Fechar janela" onClick={onClose} style={{ width:28, height:28, borderRadius:7, border:"1.5px solid var(--bd)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--t3)" }}>
        <Icon name="close" />
      </button>
    </div>
  )
}

function MField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display:"block" }}><span style={{ fontSize:12, fontWeight:600, color:"var(--t2)", display:"block", marginBottom:5 }}>{label}</span>{children}</label>
      {error && <span style={{ fontSize:11, color:"#EF4444", marginTop:4, display:"block" }}>{error}</span>}
    </div>
  )
}

const mInputStyle = (hasError: boolean): React.CSSProperties => ({
  width:"100%", padding:"9px 12px", borderRadius:8,
  border:`1.5px solid ${hasError ? "#EF4444" : "var(--bd)"}`,
  background:"var(--inp)", color:"var(--t1)", fontSize:13,
  fontFamily:"'DM Sans',sans-serif", outline:"none",
})

const mBtnPri: React.CSSProperties = { padding:"8px 16px", borderRadius:8, border:"none", background:"var(--pri)", color:"var(--pri-t)", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }
const mBtnSec: React.CSSProperties = { padding:"8px 16px", borderRadius:8, border:"1.5px solid var(--bd)", background:"transparent", color:"var(--t1)", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }
