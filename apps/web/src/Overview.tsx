import { useState, useMemo } from "react"
import { useAuth } from "./auth"
import {
  PieChart, Pie, Cell, LineChart, Line,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  initialDateRange, MARKETPLACES, STATUS_CONFIG,
  getMonthsInRange,
  formatBRL, formatBRLFull, formatDateTime, formatPct, formatGrowth,
  type Account, type Order, type MarketplaceId,
} from "./data"
import {
  DateRangePicker, MarketplaceDropdown, AccountDropdown,
  InfoTooltip, Card, SectionLabel, EmptyState, btnSec, btnPri,
} from "./ui"
import { useTheme } from "./theme"
import { summarizeOrders, periodBounds, selectOrders, percentageChange } from './kpis'

const KPI_TIPS = {
  faturamento:  "Produtos após descontos + frete cobrado do comprador, em pedidos com pagamento confirmado. Preserva a venda original mesmo após cancelamento ou devolução. Antes de reembolsos, taxas e custos; não representa lucro.",
  pedidos:      "Pedidos únicos com pagamento confirmado. Um cancelamento ou uma devolução posterior não remove a venda original; reembolsos são apresentados separadamente.",
  ticket:       "Faturamento de vendas dividido pelo número de pedidos considerados. Calculado a partir dos totais consolidados.",
  participacao: "Percentual do faturamento de cada canal dentro dos canais e contas selecionados.",
  reembolsos: "Valores efetivamente reembolsados, totais ou parciais, contados uma vez por identificador. Vinculados ao período da venda original, mesmo quando confirmados depois.",
  ajustado: "Valor original de vendas menos reembolsos confirmados. Não desconta taxas ou custos e não representa lucro. Devoluções em andamento não reduzem o valor automaticamente.",
}

const STATUS_CHART_ORDER = ["delivered","shipped","paid","pending","cancelled","returned"] as const

interface OverviewProps {
  companyId: string
  accounts: Account[]
  orders: Order[]
  onAccounts: () => void
  dataReady?: boolean
  accountsLoading?: boolean
  accountsError?: boolean
}


export default function Overview({ companyId, accounts, orders, onAccounts, dataReady, accountsLoading = false, accountsError = false }: OverviewProps) {
  const { user } = useAuth()
  const defaults = useMemo(() => initialDateRange(user.isDemoUser), [user.isDemoUser])
  const { isDark } = useTheme()
  const companyAccounts = accounts.filter(a => a.companyId === companyId)

  const [dateRange,   setDateRange]   = useState(defaults)
  const [selMarkets,  setSelMarkets]  = useState<MarketplaceId[]>(MARKETPLACES.map(m => m.id))
  const [selAccounts, setSelAccounts] = useState<string[] | null>(null)

  const allAccountIds = companyAccounts.map(a => a.id)
  const effectiveAccounts = (selAccounts ?? allAccountIds).filter(id => allAccountIds.includes(id))
  const availableMarkets = MARKETPLACES.filter(m => companyAccounts.some(a => a.marketplace === m.id && a.status !== 'pending'))
  const effectiveMarkets = selMarkets.filter(id => availableMarkets.some(m => m.id === id))

  function toggleMarket(id: MarketplaceId) {
    setSelMarkets(p => p.includes(id) ? (p.length > 1 ? p.filter(x => x !== id) : p) : [...p, id])
  }
  function toggleAccount(id: string) {
    setSelAccounts(p => (p ?? allAccountIds).includes(id) ? (p ?? allAccountIds).filter(x => x !== id) : [...(p ?? allAccountIds), id])
  }
  function clearFilters() {
    setDateRange(defaults)
    setSelMarkets(MARKETPLACES.map(m => m.id))
    setSelAccounts(null)
  }

  const bounds = periodBounds(dateRange.from, dateRange.to)
  const selection = { companyId, accountIds: effectiveAccounts, marketplaces: effectiveMarkets }
  const filtered = selectOrders(orders, { ...selection, from: bounds.start, until: bounds.end })
  const previous = selectOrders(orders, { ...selection, from: bounds.previousStart, until: bounds.previousEnd })
  const summary = summarizeOrders(filtered)
  const prev = summarizeOrders(previous)
  const loaded = dataReady ?? user.isDemoUser
  const selectedAccounts = companyAccounts.filter(account => effectiveAccounts.includes(account.id) && effectiveMarkets.includes(account.marketplace))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const covered = (from: Date, end: Date) => user.isDemoUser || (selectedAccounts.length > 0 && selectedAccounts.every(account => account.syncFrom && account.syncTo && account.syncFrom <= from && account.syncTo >= new Date(Math.min(end.getTime(), today.getTime()))))
  const coverageReady = covered(bounds.start, bounds.end)
  const ready = loaded && coverageReady && summary.complete
  const money = (value: number | null) => ready && value !== null ? formatBRL(value) : '—'
  const comparisonReady = ready && prev.complete && covered(bounds.previousStart, bounds.previousEnd)
  function growth(cur: number | null, before: number | null): string | null {
    const change = comparisonReady ? percentageChange(cur, before) : null
    return change === null ? null : formatGrowth(change)
  }
  const faturamento = summary.gross ?? 0
  const numPedidos = summary.count
  const ticketMedio = summary.ticket
  const prevTo = new Date(bounds.previousEnd.getTime() - 1)
  const prevLabel = `${bounds.previousStart.toLocaleDateString('pt-BR')} – ${prevTo.toLocaleDateString('pt-BR')}`

  const byMarket = useMemo(() =>
    MARKETPLACES.map(m => {
      const result = summarizeOrders(filtered.filter(o => o.marketplace === m.id))
      const fat = result.gross ?? 0
      const vendas = result.count ?? 0
      const ticket = result.ticket
      return { ...m, fat, vendas, ticket }
    }).filter(m => effectiveMarkets.includes(m.id))
  , [filtered, effectiveMarkets])

  const donutData = byMarket.filter(m => m.fat > 0)

  const months   = useMemo(() => getMonthsInRange(dateRange.from, dateRange.to), [dateRange])
  const lineData = useMemo(() =>
    months.map(({ label, year, month }) => {
      const row: Record<string, unknown> = { month: label }
      for (const id of effectiveMarkets) {
        row[id] = summarizeOrders(filtered.filter(o => o.marketplace === id && o.date.getFullYear() === year && o.date.getMonth() === month)).gross
      }
      return row
    })
  , [months, filtered, effectiveMarkets])

  const statusCountsSorted = useMemo(() =>
    STATUS_CHART_ORDER.map(s => ({
      name:  STATUS_CONFIG[s].label,
      value: filtered.filter(o => o.status === s).length,
      color: STATUS_CONFIG[s].dot,
    }))
  , [filtered])

  const problemAccounts = companyAccounts.filter(a => a.errorMsg || a.status === "error" || a.status === "reconnect_needed")
  const lastSync = companyAccounts.reduce<Date | null>((best, a) => a.lastSync && (!best || a.lastSync > best) ? a.lastSync : best, null)

  const hasData = filtered.length > 0

  const gridColor  = isDark ? "rgba(255,255,255,0.06)" : "#E8EBF2"
  const axisColor  = isDark ? "#6B7A99" : "#8892A4"
  const ttStyle: React.CSSProperties = { background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:8, fontFamily:"'DM Sans',sans-serif", boxShadow:`0 4px 16px var(--shd)`, color:"var(--t1)" }

  if (accountsLoading) return <div role="status" className="page-body"><EmptyState icon="⌛" title="Carregando contas" desc="Consultando as integrações da empresa." /></div>
  if (accountsError) return <div className="page-body"><EmptyState icon="⚠" title="Não foi possível consultar as contas" desc="Tente novamente para verificar as integrações desta empresa." /></div>
  const connected = companyAccounts.some(a => a.status === 'connected' || a.status === 'syncing')
  const hasHistory = companyAccounts.some(a => a.lastSync !== null) || orders.some(o => o.companyId === companyId && allAccountIds.includes(o.accountId))
  if (!connected && !hasHistory) return <div className="page-body"><EmptyState icon="🔌" title={companyAccounts.some(a => a.status === 'error' || a.status === 'reconnect_needed') ? 'Revise suas integrações' : 'Sua visão geral começa aqui'} desc="Conecte uma conta de marketplace para acompanhar as vendas desta empresa." action={<button onClick={onAccounts} style={btnPri}>Conectar conta</button>} /></div>
  if (!loaded) return <div className="page-body"><EmptyState icon="⌛" title={hasHistory ? 'Dados de vendas indisponíveis' : 'Aguardando primeira sincronização'} desc={hasHistory ? 'Os dados necessários aos indicadores ainda não estão disponíveis. Confira a situação das contas.' : 'Sua conta está conectada. Em Contas, clique em Atualizar dados para importar os pedidos.'} action={<button onClick={onAccounts} style={btnSec}>Ver contas e integrações</button>} /></div>

  return (
    <div className="page-body" style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:20 }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {lastSync && <span style={{ fontSize:12, color:"var(--t3)" }}>Última atualização: <strong style={{color:"var(--t2)"}}>{formatDateTime(lastSync)}</strong></span>}
        </div>
        {problemAccounts.length > 0 && (
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#FEF3C7", border:"1px solid #FCD34D", borderRadius:8, padding:"6px 12px" }}>
            <span style={{ fontSize:12, color:"#92400E", fontWeight:500 }}>
              ⚠ {problemAccounts.map(a => a.name).join(", ")} — dados podem estar desatualizados.
            </span>
          </div>
        )}
      </div>

      <div style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:"var(--t3)", fontWeight:600 }}>Filtros:</span>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <MarketplaceDropdown selected={effectiveMarkets} onToggle={toggleMarket} available={availableMarkets.map(m => m.id)} />
        <AccountDropdown accounts={companyAccounts} selected={effectiveAccounts} onToggle={toggleAccount} />
        <div style={{ flex:1 }} />
        <button onClick={clearFilters} style={{ ...btnSec, fontSize:12, padding:"5px 12px" }}>Limpar filtros</button>
      </div>

      {!coverageReady && <div className="app-alert" role="status">O período selecionado não está totalmente coberto pela sincronização das contas. Os indicadores ficam indisponíveis até consultar esse período.</div>}
      {coverageReady && !summary.complete && <div className="app-alert" role="status">Há pedidos com valores financeiros indisponíveis. Consulte os detalhes em Pedidos; os totais não serão estimados.</div>}
      {!hasData && coverageReady && (
        <>
          <EmptyState icon="🔍" title="Nenhuma venda neste período" desc="Os filtros selecionados não retornaram pedidos. Ajuste o período, os canais ou as contas." action={<button onClick={clearFilters} style={btnPri}>Limpar filtros</button>} />
        </>
      )}
      {(hasData || !user.isDemoUser) &&
        <>
          <div>
            <SectionLabel>Resultado por canal</SectionLabel>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14 }}>
              {byMarket.map(m => {
                const isBlack = m.color === "#000000"
                const borderColor = isDark && isBlack ? "rgba(255,255,255,0.25)" : m.color
                return (
                  <div key={m.id} style={{ border:`2px solid ${borderColor}`, borderRadius:14, background:"var(--sf)", overflow:"hidden" }}>
                    <div style={{ background:m.color, padding:"9px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span style={{ fontWeight:800, fontSize:12, color:m.text, letterSpacing:"0.02em" }}>{m.label}</span>
                      {ready && faturamento > 0 && (
                        <span style={{ fontSize:10, fontWeight:700, color:m.text, background:"rgba(0,0,0,0.15)", padding:"2px 6px", borderRadius:20, fontFamily:"'JetBrains Mono',monospace" }}>
                          {formatPct((m.fat/faturamento)*100)}
                        </span>
                      )}
                    </div>
                    <div style={{ padding:"14px 16px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                      <div>
                        <div style={{ fontSize:10, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600, marginBottom:2 }}>Faturamento</div>
                        <div style={{ fontSize:16, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:"var(--t1)", letterSpacing:"-0.02em", lineHeight:1.2, overflowWrap:"anywhere" }}>{money(m.fat)}</div>
                        {!ready && <small style={{ color:'var(--t3)' }}>Aguardando sincronização</small>}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, borderTop:"1px solid var(--bd)", paddingTop:10 }}>
                        <div>
                          <div style={{ fontSize:10, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.05em", fontWeight:600, marginBottom:2 }}>Pedidos</div>
                          <div style={{ fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:"var(--t1)" }}>{ready ? m.vendas.toLocaleString("pt-BR") : '—'}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:10, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.05em", fontWeight:600, marginBottom:2 }}>Ticket</div>
                          <div style={{ fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:"var(--t1)" }}>{ready && m.ticket !== null ? formatBRLFull(m.ticket) : "—"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Consolidado dos canais selecionados</SectionLabel>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14 }}>
              <AggKpi
                label="Faturamento de vendas"
                tip={KPI_TIPS.faturamento}
                value={money(summary.gross)}
                growth={growth(summary.gross, prev.gross)}
                prevLabel={prevLabel}
                emptyNote={!ready ? 'Aguardando sincronização' : undefined}
              />
              <AggKpi
                label="Pedidos no faturamento"
                tip={KPI_TIPS.pedidos}
                value={ready && numPedidos !== null ? numPedidos.toLocaleString("pt-BR") : '—'}
                growth={growth(numPedidos, prev.count)}
                prevLabel={prevLabel}
                emptyNote={!ready ? 'Aguardando sincronização' : undefined}
                mono={false}
              />
              <AggKpi
                label="Ticket médio"
                tip={KPI_TIPS.ticket}
                value={ready && ticketMedio !== null ? formatBRLFull(ticketMedio) : "—"}
                growth={growth(ticketMedio, prev.ticket)}
                prevLabel={prevLabel}
                emptyNote={!ready ? 'Aguardando sincronização' : ticketMedio === null ? "Sem pedidos no faturamento" : undefined}
              />
            </div>
          </div>

          <div>
            <SectionLabel>Ajustes das vendas selecionadas</SectionLabel>
            <div className="kpi-adjustments">
              <AggKpi label="Reembolsos confirmados" tip={KPI_TIPS.reembolsos} value={money(summary.refunds)} growth={growth(summary.refunds, prev.refunds)} prevLabel={prevLabel} neutralGrowth emptyNote={!ready ? 'Aguardando sincronização' : undefined} />
              <AggKpi label="Vendas após reembolsos" tip={KPI_TIPS.ajustado} value={money(summary.adjusted)} growth={growth(summary.adjusted, prev.adjusted)} prevLabel={prevLabel} emptyNote={!ready ? 'Aguardando sincronização' : undefined} />
            </div>
            <p style={{ fontSize:12, color:'var(--t3)', margin:'10px 0 0' }}>Reembolsos vinculados à data da venda original. Valores anteriores a taxas e custos; não representam lucro.</p>
          </div>

          <div className="kpi-events">
            <SecondaryIndicator label="Cancelamentos" count={ready ? summary.cancelled : null} note={ready ? `${summary.cancelledValue === null ? 'Valor indisponível' : formatBRLFull(summary.cancelledValue)} em pedidos cancelados. Reembolsos contabilizados separadamente.` : 'Aguardando sincronização'} color="#EF4444" bg="#FEE2E2" textColor="#991B1B" icon="✕" />
            <SecondaryIndicator label="Devoluções" count={ready ? summary.returns : null} note={ready && summary.returns !== null ? `${summary.returnsPending} em andamento · ${summary.returnsCompleted} concluídas. Contagem por pedido; um pedido pode ter etapas distintas por item.` : 'Aguardando sincronização'} color="#F97316" bg="#FFEDD5" textColor="#9A3412" icon="↩" />
            <SecondaryIndicator label="Pedidos reembolsados" count={ready ? summary.refundOrders : null} note="Inclui reembolsos totais e parciais confirmados, com ou sem devolução." color="#6366F1" bg="#E0E7FF" textColor="#4338CA" icon="↙" />
          </div>

          {ready && hasData && <>
          <div className="chart-grid" style={{ display:"grid", gridTemplateColumns:"290px 1fr", gap:14 }}>
            <Card title="Participação por canal">
              {donutData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie data={donutData} cx="50%" cy="50%" innerRadius={58} outerRadius={85} paddingAngle={3} dataKey="fat" strokeWidth={0}>
                        {donutData.map(m => <Cell key={m.id} fill={m.color} />)}
                      </Pie>
                      <text textAnchor="middle" dominantBaseline="middle">
                        <tspan x="50%" y="46%" fontSize={10} fill="var(--t3)">Total</tspan>
                        <tspan x="50%" y="57%" fontSize={11} fontFamily="'JetBrains Mono',monospace" fontWeight={700} fill="var(--t1)">{formatBRL(faturamento)}</tspan>
                      </text>
                      <Tooltip formatter={(v) => formatBRLFull(Number(v ?? 0))} contentStyle={ttStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {donutData.map(m => (
                      <div key={m.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ width:9, height:9, borderRadius:2, background:m.color, border:m.color==="#000000"?"1px solid var(--bd2)":"none", flexShrink:0 }} />
                        <span style={{ flex:1, fontSize:12, color:"var(--t2)" }}>{m.label}</span>
                        <span style={{ fontSize:11, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:"var(--t1)" }}>{faturamento>0?formatPct((m.fat/faturamento)*100):"0,0%"}</span>
                        <span style={{ fontSize:11, fontFamily:"'JetBrains Mono',monospace", color:"var(--t3)", minWidth:80, textAlign:"right" }}>{formatBRL(m.fat)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <EmptyState icon="📊" title="Sem dados" desc="Nenhum pedido no período." />}
            </Card>

            <Card title="Evolução mensal de faturamento">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={lineData} margin={{ top:4, right:4, left:-8, bottom:0 }}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill:axisColor, fontSize:11, fontFamily:"'DM Sans',sans-serif" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatBRL} tick={{ fill:axisColor, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }} axisLine={false} tickLine={false} width={96} />
                  <Tooltip content={<LineTooltip ttStyle={ttStyle} />} />
                  {effectiveMarkets.map(id => {
                    const m = MARKETPLACES.find(x => x.id === id)!
                    return <Line key={id} type="monotone" dataKey={id} stroke={m.color} strokeWidth={2.5} dot={false} activeDot={{ r:4, fill:m.color, stroke:"var(--sf)", strokeWidth:2 }} />
                  })}
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
                {effectiveMarkets.map(id => {
                  const m = MARKETPLACES.find(x => x.id === id)!
                  return (
                    <div key={id} style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ width:20, height:3, background:m.color, borderRadius:2 }} />
                      <span style={{ fontSize:11, color:"var(--t2)" }}>{m.label}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          <div>
            <Card title="Pedidos por situação">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={statusCountsSorted} margin={{ top:4, right:8, left:-8, bottom:0 }}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill:axisColor, fontSize:11, fontFamily:"'DM Sans',sans-serif" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:axisColor, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip formatter={(v) => [`${v} pedidos`, ""]} contentStyle={ttStyle} />
                  <Bar dataKey="value" radius={[5,5,0,0]} maxBarSize={64}>
                    {statusCountsSorted.map(s => <Cell key={s.name} fill={s.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

          </div>
          </>}
        </>
      }
    </div>
  )
}


function AggKpi({ label, tip, value, growth, prevLabel, mono = true, emptyNote, neutralGrowth = false }: {
  label: string; tip: string; value: string; growth: string | null; prevLabel: string; mono?: boolean; emptyNote?: string; neutralGrowth?: boolean
}) {
  const pos = growth ? !growth.startsWith("-") : true
  return (
    <div role="group" aria-label={label} className="kpi-card" style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:14, padding:"18px 20px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:11, color:"var(--t3)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</span>
        <InfoTooltip text={tip} />
      </div>
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:8 }}>
        <span style={{ fontSize:22, fontWeight:700, color:"var(--t1)", lineHeight:1.1, fontFamily:mono?"'JetBrains Mono',monospace":"'DM Sans',sans-serif", letterSpacing:mono?"-0.03em":"-0.02em" }}>
          {value}
        </span>
        {emptyNote ? (
          <span style={{ fontSize:11, color:"var(--t3)", fontStyle:"italic", marginBottom:2 }}>{emptyNote}</span>
        ) : growth !== null
          ? <span style={{ fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:20, background:neutralGrowth?'var(--sf3)':pos?"#DCFCE7":"#FEE2E2", color:neutralGrowth?'var(--t2)':pos?"#16a34a":"#dc2626", fontFamily:"'JetBrains Mono',monospace", whiteSpace:"nowrap", marginBottom:2 }}>
              {pos?"↑":"↓"} {growth.replace("+","")}
            </span>
          : <span style={{ fontSize:11, color:"var(--t3)", fontStyle:"italic", marginBottom:2 }}>Sem base de comparação</span>
        }
      </div>
      <span style={{ fontSize:10, color:"var(--t4)" }}>vs. {prevLabel}</span>
    </div>
  )
}

function SecondaryIndicator({ label, count, note, color, bg, textColor, icon }: {
  label: string; count: number | null; note: string; color: string; bg: string; textColor: string; icon: string
}) {
  return (
    <div role="group" aria-label={label} style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:14, padding:"16px 18px", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ width:24, height:24, borderRadius:6, background:bg, color, fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>{icon}</span>
        <span style={{ fontSize:12, fontWeight:600, color:textColor }}>{label}</span>
      </div>
      <div>
        <div style={{ fontSize:18, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:textColor }}>{count === null ? '—' : `${count.toLocaleString('pt-BR')} pedidos`}</div>
        <div style={{ fontSize:12, color:"var(--t3)", marginTop:2 }}>{count === null ? 'Aguardando sincronização' : note}</div>
      </div>
    </div>
  )
}

function LineTooltip({ active, payload, label, ttStyle }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; ttStyle: React.CSSProperties
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ ...ttStyle, padding:"10px 14px" }}>
      <p style={{ margin:"0 0 8px", fontSize:11, color:"var(--t3)", fontWeight:600 }}>{label}</p>
      {payload.map(p => {
        const m = MARKETPLACES.find(x => x.id === p.name)
        return (
          <div key={p.name} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ width:9, height:9, borderRadius:2, background:p.color, border:p.color==="#000000"?"1px solid var(--bd2)":"none", flexShrink:0 }} />
            <span style={{ fontSize:12, color:"var(--t2)", flex:1 }}>{m?.label ?? p.name}</span>
            <span style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:"var(--t1)" }}>{formatBRLFull(p.value)}</span>
          </div>
        )
      })}
    </div>
  )
}
