import { useState, useEffect, useRef } from "react"
import { useAuth } from "./auth"
import { ptBR } from "react-day-picker/locale"
import { DayPicker } from "react-day-picker"
import type { DateRange } from "react-day-picker"
import "react-day-picker/dist/style.css"
import { MARKETPLACES, STATUS_CONFIG, ALL_STATUSES, DEMO_NOW, type MarketplaceId, type OrderStatus, type Account } from "./data"




export interface DateRangeValue {
  from: Date
  to: Date
}

interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (r: DateRangeValue) => void
}

function shortcutRange(type: "thisMonth" | "lastMonth" | "last30", now: Date): DateRangeValue {
  if (type === "thisMonth") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) }
  }
  if (type === "lastMonth") {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) }
  }
  const to = new Date(now); to.setHours(23,59,59)
  const from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0,0,0)
  return { from, to }
}

function fmtShort(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<DateRange>({ from: value.from, to: value.to })
  const [mFrom, setMFrom] = useState(new Date(value.from.getFullYear(), value.from.getMonth(), 1))
  const [mTo,   setMTo]   = useState(new Date(value.to.getFullYear(),   value.to.getMonth(),   1))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  function applyShortcut(type: "thisMonth" | "lastMonth" | "last30") {
    const r = shortcutRange(type, user.isDemoUser ? DEMO_NOW : new Date())
    setLocal({ from: r.from, to: r.to })
    setMFrom(new Date(r.from.getFullYear(), r.from.getMonth(), 1))
    setMTo(new Date(r.to.getFullYear(), r.to.getMonth(), 1))
    onChange(r)
    setOpen(false)
  }

  function handleApply() {
    if (local.from && local.to) { onChange({ from: local.from, to: local.to }); setOpen(false) }
  }

  const label = `${fmtShort(value.from)} – ${fmtShort(value.to)}`

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button aria-label="Selecionar período" aria-expanded={open} onClick={() => { setLocal(value); setMFrom(new Date(value.from.getFullYear(), value.from.getMonth(), 1)); setMTo(new Date(value.to.getFullYear(), value.to.getMonth(), 1)); setOpen(v => !v) }} style={triggerStyle}>
        <CalIcon /> {label} <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="date-popover" style={{ position:"absolute", top:"calc(100% + 6px)", left:0, background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:12, boxShadow:`0 8px 32px var(--shd)`, zIndex:200, overflow:"hidden" }}>
          <div style={{ display:"flex", flexWrap:"wrap" }}>
            <div style={{ borderRight:"1px solid var(--bd)", padding:"12px 8px", display:"flex", flexDirection:"column", gap:2, minWidth:130 }}>
              <span style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.06em", padding:"0 8px 6px" }}>Atalhos</span>
              {([["thisMonth","Este mês"],["lastMonth","Mês passado"],["last30","Últimos 30 dias"]] as const).map(([k,l]) => (
                <button key={k} onClick={() => applyShortcut(k)} style={{ padding:"7px 10px", borderRadius:6, border:"none", background:"transparent", color:"var(--t1)", fontSize:12, fontWeight:500, cursor:"pointer", textAlign:"left", fontFamily:"'DM Sans',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background="var(--hover)"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}
                >
                  {l}
                </button>
              ))}
            </div>
            <div style={{ padding:"12px 8px", display:"flex", gap:4, flexWrap:"wrap" }}>
              <DayPicker mode="range" selected={local} onSelect={r => r && setLocal(r)} month={mFrom} onMonthChange={setMFrom} locale={ptBR} numberOfMonths={1} />
              <div style={{ width:1, background:"var(--bd)", alignSelf:"stretch" }} />
              <DayPicker mode="range" selected={local} onSelect={r => r && setLocal(r)} month={mTo} onMonthChange={setMTo} locale={ptBR} numberOfMonths={1} />
            </div>
          </div>
          <div style={{ borderTop:"1px solid var(--bd)", padding:"10px 16px", display:"flex", justifyContent:"flex-end", gap:8 }}>
            <button onClick={() => setOpen(false)} style={btnSec}>Fechar</button>
            {local.from && local.to && <button onClick={handleApply} style={btnPri}>Aplicar</button>}
          </div>
        </div>
      )}
    </div>
  )
}


interface MultiSelectProps<T extends string> {
  options: Array<{ id: T; label: string; color?: string }>
  selected: T[]
  onToggle: (id: T) => void
  placeholder: string
  allLabel: string
  minOne?: boolean
}

function MultiSelectDropdown<T extends string>({ options, selected, onToggle, placeholder, allLabel, minOne }: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  const label = selected.length === 0 ? placeholder
    : selected.length === options.length ? allLabel
    : options.filter(o => selected.includes(o.id)).map(o => o.label).join(", ")

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ ...triggerStyle, maxWidth:240 }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{label}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:10, boxShadow:`0 8px 24px var(--shd)`, padding:"6px 0", minWidth:200, zIndex:200 }}>
          {options.map(o => {
            const on = selected.includes(o.id)
            const disabled = minOne && on && selected.length === 1
            return (
              <button key={o.id} disabled={disabled} onClick={() => onToggle(o.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 14px", border:"none", background:"transparent", cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.4:1, fontFamily:"'DM Sans',sans-serif" }}
                onMouseEnter={e => { if (!disabled) e.currentTarget.style.background="var(--hover)" }}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}
              >
                <Checkbox checked={on} />
                {o.color !== undefined && <span style={{ width:9, height:9, borderRadius:2, background:o.color, border:o.color==="#000000"||o.color==="transparent"?"1px solid var(--bd2)":"none", flexShrink:0 }} />}
                <span style={{ fontSize:13, color:"var(--t1)", fontWeight:500, textAlign:"left" }}>{o.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MarketplaceDropdown({ selected, onToggle, available }: { selected: MarketplaceId[]; onToggle: (id: MarketplaceId) => void; available?: MarketplaceId[] }) {
  return (
    <MultiSelectDropdown
      options={MARKETPLACES.filter(m => !available || available.includes(m.id)).map(m => ({ id: m.id, label: m.label, color: m.color }))}
      selected={selected}
      onToggle={onToggle}
      placeholder="Nenhum canal"
      allLabel="Todos os canais"
      minOne
    />
  )
}

export function AccountDropdown({ accounts, selected, onToggle }: { accounts: Account[]; selected: string[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  const label = selected.length === accounts.length ? "Todas as contas"
    : selected.length === 0 ? "Nenhuma conta"
    : accounts.filter(a => selected.includes(a.id)).map(a => a.name).join(", ")

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ ...triggerStyle, maxWidth:220 }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{label}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:10, boxShadow:`0 8px 24px var(--shd)`, padding:"6px 0", minWidth:210, zIndex:200 }}>
          {accounts.map(a => {
            const on = selected.includes(a.id)
            const m = MARKETPLACES.find(x => x.id === a.marketplace)!
            return (
              <button key={a.id} onClick={() => onToggle(a.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 14px", border:"none", background:"transparent", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background="var(--hover)"}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}
              >
                <Checkbox checked={on} />
                <span style={{ width:9, height:9, borderRadius:2, background:m.color, border:m.color==="#000000"?"1px solid var(--bd2)":"none", flexShrink:0 }} />
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:13, color:"var(--t1)", fontWeight:500 }}>{a.name}</div>
                  <div style={{ fontSize:10, color:"var(--t3)" }}>{m.label}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function StatusDropdown({ selected, onToggle }: { selected: OrderStatus[]; onToggle: (s: OrderStatus) => void }) {
  return (
    <MultiSelectDropdown
      options={ALL_STATUSES.map(s => ({ id: s, label: STATUS_CONFIG[s].label }))}
      selected={selected}
      onToggle={onToggle}
      placeholder="Todas as situações"
      allLabel="Todas as situações"
    />
  )
}


export function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<"left" | "right">("right")

  useEffect(() => {
    if (show && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos(rect.left > window.innerWidth / 2 ? "left" : "right")
    }
  }, [show])

  return (
    <div ref={ref} style={{ position:"relative", display:"inline-flex" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ fontSize:12, color:"var(--t4)", cursor:"help", lineHeight:1 }}>ⓘ</span>
      {show && (
        <div style={{ position:"absolute", top:"50%", [pos==="right"?"left":"right"]:"calc(100% + 6px)", transform:"translateY(-50%)", background:"var(--t1)", color:"var(--sf)", fontSize:12, lineHeight:1.5, padding:"8px 12px", borderRadius:8, width:240, zIndex:300, boxShadow:"0 4px 16px rgba(0,0,0,0.2)", pointerEvents:"none" }}>
          {text}
        </div>
      )}
    </div>
  )
}


export function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span style={{ background:cfg.bg, color:cfg.color, fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:20, whiteSpace:"nowrap", display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:cfg.dot }} />
      {cfg.label}
    </span>
  )
}


export function Spinner() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:64 }}>
      <div style={{ width:32, height:32, borderRadius:"50%", border:"3px solid var(--bd)", borderTopColor:"var(--t1)", animation:"spin 0.7s linear infinite" }} />
    </div>
  )
}


export function Card({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:14, padding:"20px 22px", display:"flex", flexDirection:"column", gap:14 }}>
      {(title || action) && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          {title && <h2 style={{ margin:0, fontSize:13, fontWeight:700, color:"var(--t1)" }}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}


export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ margin:"0 0 10px", fontSize:11, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{children}</p>
}


export function EmptyState({ icon, title, desc, action }: { icon: string; title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"48px 24px", gap:12, textAlign:"center" }}>
      <span style={{ fontSize:36 }}>{icon}</span>
      <div style={{ fontWeight:700, fontSize:15, color:"var(--t1)" }}>{title}</div>
      <div style={{ fontSize:13, color:"var(--t3)", maxWidth:320 }}>{desc}</div>
      {action}
    </div>
  )
}


export const btnPri: React.CSSProperties = { padding:"7px 16px", borderRadius:7, border:"none", background:"var(--pri)", color:"var(--pri-t)", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }
export const btnSec: React.CSSProperties = { padding:"7px 16px", borderRadius:7, border:"1.5px solid var(--bd)", background:"transparent", color:"var(--t1)", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }
const triggerStyle: React.CSSProperties = { display:"flex", alignItems:"center", gap:8, padding:"7px 12px", borderRadius:8, border:"1.5px solid var(--bd)", background:"var(--inp)", fontSize:13, fontWeight:500, color:"var(--t1)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }


function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span style={{ width:16, height:16, borderRadius:4, border:checked?"none":"1.5px solid var(--bd2)", background:checked?"var(--pri)":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      {checked && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3l2.5 2.5L8 1" stroke="var(--pri-t)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </span>
  )
}

function CalIcon() {
  return <svg width={13} height={13} viewBox="0 0 13 13" fill="none" style={{flexShrink:0}}><rect x=".5" y="2" width="12" height="10.5" rx="1.8" stroke="var(--t3)" strokeWidth={1.2}/><path d="M.5 5h12" stroke="var(--t3)" strokeWidth={1.2}/><path d="M4 .5v3M9 .5v3" stroke="var(--t3)" strokeWidth={1.2} strokeLinecap="round"/></svg>
}

export function ChevronIcon({ open }: { open: boolean }) {
  return <svg width={11} height={11} viewBox="0 0 11 11" fill="none" style={{flexShrink:0,transform:open?"rotate(180deg)":"none",transition:"transform 0.15s"}}><path d="M2 4l3.5 3.5L9 4" stroke="var(--t3)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"/></svg>
}

export function MarketplaceDot({ id }: { id: MarketplaceId }) {
  const m = MARKETPLACES.find(x => x.id === id)!
  return <span style={{ width:9, height:9, borderRadius:2, background:m.color, border:m.color==="#000000"?"1px solid var(--bd2)":"none", display:"inline-block", flexShrink:0 }} />
}
