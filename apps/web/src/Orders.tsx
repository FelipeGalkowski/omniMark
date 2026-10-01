import { Icon } from './Icon'
import { useState, useMemo } from "react"
import { useAuth } from "./auth"
import { orderSale, confirmedRefunds } from './kpis'
import {
  initialDateRange, MARKETPLACES, ALL_STATUSES, STATUS_CONFIG,
  orderItemsTotal,
  formatBRLFull, formatDate, formatDateTime,
  type Account, type Order, type OrderStatus, type MarketplaceId,
} from "./data"
import {
  DateRangePicker, AccountDropdown, MarketplaceDropdown, StatusDropdown,
  StatusBadge, EmptyState, btnSec, btnPri, MarketplaceDot,
} from "./ui"

const PAGE_SIZE    = 20

interface OrdersPageProps {
  companyId: string
  accounts: Account[]
  orders: Order[]
}

export default function OrdersPage({ companyId, accounts, orders }: OrdersPageProps) {
  const { user } = useAuth()
  const defaults = useMemo(() => initialDateRange(user.isDemoUser), [user.isDemoUser])
  const companyAccounts = accounts.filter(a => a.companyId === companyId)
  const allAccountIds   = companyAccounts.map(a => a.id)

  const [dateRange,     setDateRange]     = useState(defaults)
  const [selMarkets,    setSelMarkets]    = useState<MarketplaceId[]>(MARKETPLACES.map(m => m.id))
  const [selAccounts,   setSelAccounts]   = useState<string[]>(allAccountIds)
  const [selStatuses,   setSelStatuses]   = useState<OrderStatus[]>([...ALL_STATUSES])
  const [search,        setSearch]        = useState("")
  const [page,          setPage]          = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const effectiveAccounts = selAccounts.filter(id => allAccountIds.includes(id))

  function toggleMarket(id: MarketplaceId)  { setSelMarkets(p => p.includes(id) ? (p.length>1?p.filter(x=>x!==id):p) : [...p,id]); setPage(1) }
  function toggleAccount(id: string)         { setSelAccounts(p => p.includes(id) ? p.filter(x=>x!==id) : [...p,id]); setPage(1) }
  function toggleStatus(s: OrderStatus)      { setSelStatuses(p => p.includes(s) ? p.filter(x=>x!==s) : [...p,s]); setPage(1) }

  function clearFilters() {
    setDateRange(defaults)
    setSelMarkets(MARKETPLACES.map(m => m.id))
    setSelAccounts(allAccountIds)
    setSelStatuses([...ALL_STATUSES])
    setSearch("")
    setPage(1)
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return orders.filter(o =>
      o.companyId === companyId &&
      (effectiveAccounts.includes(o.accountId)) &&
      selMarkets.includes(o.marketplace) &&
      selStatuses.includes(o.status) &&
      o.date >= dateRange.from &&
      o.date <= new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate(), 23,59,59) &&
      (term === "" || o.id.toLowerCase().includes(term))
    )
  }, [orders, companyId, effectiveAccounts, selMarkets, selStatuses, dateRange, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageOrders = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  return (
    <div className="page-body" style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:16, position:"relative" }}>

      <div style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flexShrink:0 }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Buscar por nº do pedido…"
            style={{ padding:"7px 12px 7px 32px", borderRadius:8, border:"1.5px solid var(--bd)", fontSize:13, color:"var(--t1)", background:"var(--inp)", fontFamily:"'DM Sans',sans-serif", outline:"none", width:200 }}
          />
          <Icon name="search" style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"var(--t3)" }} />
        </div>
        <DateRangePicker value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
        <MarketplaceDropdown selected={selMarkets} onToggle={toggleMarket} />
        <AccountDropdown accounts={companyAccounts} selected={effectiveAccounts} onToggle={toggleAccount} />
        <StatusDropdown selected={selStatuses} onToggle={toggleStatus} />
        <div style={{ flex:1 }} />
        <button onClick={clearFilters} style={{ ...btnSec, fontSize:12, padding:"5px 12px" }}>Limpar</button>
      </div>

      {filtered.length > 0 && (
        <div style={{ fontSize:12, color:"var(--t3)" }}>
          <strong style={{ color:"var(--t2)" }}>{filtered.length.toLocaleString("pt-BR")}</strong> pedidos encontrados · página {page} de {totalPages}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon="orders" title={user.isDemoUser ? "Nenhum pedido encontrado" : "Nenhum pedido sincronizado"} desc={user.isDemoUser ? "Ajuste os filtros ou a busca para encontrar pedidos." : "Os pedidos aparecerão aqui quando as integrações com marketplaces estiverem disponíveis."} action={user.isDemoUser ? <button onClick={clearFilters} style={btnPri}>Limpar filtros</button> : undefined} />
      ) : (
        <div style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:14, overflow:"auto" }}>
          <table style={{ minWidth:760, width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"var(--sf2)", borderBottom:"1px solid var(--bd)" }}>
                {["Nº Pedido","Data","Canal","Conta","Situação","Valor dos Produtos"].map(h => (
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageOrders.map((o, i) => {
                const acct = accounts.find(a => a.id === o.accountId)
                return (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrder(o)}
                    style={{ borderBottom:i<pageOrders.length-1?"1px solid var(--bd)":"none", cursor:"pointer", transition:"background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--hover)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding:"12px 14px", fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--t2)", whiteSpace:"nowrap" }}>{o.id}</td>
                    <td style={{ padding:"12px 14px", color:"var(--t2)", whiteSpace:"nowrap" }}>{formatDate(o.date)}</td>
                    <td style={{ padding:"12px 14px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <MarketplaceDot id={o.marketplace} />
                        <span style={{ color:"var(--t1)" }}>{MARKETPLACES.find(m => m.id === o.marketplace)?.label}</span>
                      </div>
                    </td>
                    <td style={{ padding:"12px 14px", color:"var(--t2)", whiteSpace:"nowrap" }}>{acct?.name ?? "—"}</td>
                    <td style={{ padding:"12px 14px" }}><StatusBadge status={o.status} /></td>
                    <td style={{ padding:"12px 14px", fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--t1)", textAlign:"right", whiteSpace:"nowrap" }}>
                      {formatBRLFull(orderItemsTotal(o))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, flexWrap:"wrap" }}>
          <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} style={{ ...btnSec, padding:"5px 12px", fontSize:12, opacity:page===1?0.4:1 }}><Icon name="arrowLeft" /> Anterior</button>
          {Array.from({length:Math.min(7,totalPages)},(_,i) => {
            const p = totalPages <= 7 ? i+1 : page <= 4 ? i+1 : page >= totalPages-3 ? totalPages-6+i : page-3+i
            return (
              <button key={p} onClick={() => setPage(p)} style={{ width:32, height:32, borderRadius:7, border:"1.5px solid", borderColor:page===p?"var(--t1)":"var(--bd)", background:page===p?"var(--pri)":"transparent", color:page===p?"var(--pri-t)":"var(--t2)", fontSize:13, fontWeight:page===p?700:400, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>{p}</button>
            )
          })}
          <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} style={{ ...btnSec, padding:"5px 12px", fontSize:12, opacity:page===totalPages?0.4:1 }}>Próxima <Icon name="arrowRight" /></button>
        </div>
      )}

      {selectedOrder && (
        <OrderPanel order={selectedOrder} accounts={accounts} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  )
}


function OrderPanel({ order, accounts, onClose }: { order: Order; accounts: Account[]; onClose: () => void }) {
  const acct       = accounts.find(a => a.id === order.accountId)
  const mkt        = MARKETPLACES.find(m => m.id === order.marketplace)!
  const itemsTotal = orderItemsTotal(order)
  const grand      = orderSale(order)
  const refunds    = confirmedRefunds(order)
  const cfg        = STATUS_CONFIG[order.status]

  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.25)", zIndex:40 }} />
      <div style={{ position:"fixed", top:0, right:0, bottom:0, width:420, maxWidth:"100vw", background:"var(--sf)", boxShadow:"-4px 0 32px var(--shd2)", zIndex:50, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"18px 22px", borderBottom:"1px solid var(--bd)", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:"var(--t3)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Detalhes do pedido</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:700, color:"var(--t1)", marginTop:4 }}>{order.id}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6 }}>
              <StatusBadge status={order.status} />
              <span style={{ fontSize:12, color:"var(--t3)" }}>{formatDateTime(order.date)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:7, border:"1.5px solid var(--bd)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"var(--t3)" }}>
            <Icon name="close" />
          </button>
        </div>

        <div style={{ flex:1, overflow:"auto", padding:"18px 22px", display:"flex", flexDirection:"column", gap:18 }}>
          <div style={{ background:"var(--sf2)", borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:6 }}>
            <Row label="Canal">
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ width:9, height:9, borderRadius:2, background:mkt.color, border:mkt.color==="#000000"?"1px solid var(--bd2)":"none" }} />
                {mkt.label}
              </div>
            </Row>
            <Row label="Conta">{acct?.name ?? "—"}</Row>
          </div>

          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Itens</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--bd)" }}>
                  <th style={{ textAlign:"left", padding:"0 0 6px", fontSize:11, fontWeight:700, color:"var(--t3)" }}>Produto</th>
                  <th style={{ textAlign:"center", padding:"0 0 6px", fontSize:11, fontWeight:700, color:"var(--t3)", width:36 }}>Qtd</th>
                  <th style={{ textAlign:"right", padding:"0 0 6px", fontSize:11, fontWeight:700, color:"var(--t3)", whiteSpace:"nowrap" }}>Unit.</th>
                  <th style={{ textAlign:"right", padding:"0 0 6px", fontSize:11, fontWeight:700, color:"var(--t3)" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, i) => (
                  <tr key={i} style={{ borderBottom:i<order.items.length-1?"1px solid var(--bd)":"none" }}>
                    <td style={{ padding:"8px 0", color:"var(--t1)", lineHeight:1.3 }}>{item.name}</td>
                    <td style={{ padding:"8px 0", textAlign:"center", color:"var(--t2)" }}>{item.qty}</td>
                    <td style={{ padding:"8px 0", textAlign:"right", fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--t2)", whiteSpace:"nowrap" }}>{formatBRLFull(item.unitPrice)}</td>
                    <td style={{ padding:"8px 0", textAlign:"right", fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--t1)", fontWeight:600, whiteSpace:"nowrap" }}>{formatBRLFull(item.qty * item.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ borderTop:"1px solid var(--bd)", paddingTop:12, display:"flex", flexDirection:"column", gap:6 }}>
            <Row label={order.financials?.productsTotal !== undefined ? 'Produtos após descontos' : 'Subtotal (produtos)'} mono>{formatBRLFull(order.financials?.productsTotal ?? itemsTotal)}</Row>
            {order.financials?.productsTotal === undefined && <Row label="Descontos" mono>{order.financials ? formatBRLFull(order.financials.discount) : '—'}</Row>}
            <Row label="Frete do comprador" mono>{order.shippingKnown === false ? '—' : formatBRLFull(order.shipping)}</Row>
            <div style={{ borderTop:"1px solid var(--bd)", paddingTop:8, marginTop:2, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, fontWeight:700, color:"var(--t1)" }}>Total do pedido</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight:700, color:"var(--t1)" }}>{grand === null ? '—' : formatBRLFull(grand)}</span>
            </div>
            <Row label="Reembolsos confirmados" mono>{refunds === null ? '—' : formatBRLFull(refunds)}</Row>
            <Row label="Valor após reembolsos" mono>{grand === null || refunds === null ? '—' : formatBRLFull(grand - refunds)}</Row>
            <p style={{ fontSize:12, color:'var(--t3)' }}>{order.financials ? order.financials.paymentConfirmed ? 'Pagamento confirmado: a venda original compõe o faturamento. Reembolsos são descontados apenas do valor ajustado.' : 'Sem pagamento confirmado: não compõe o faturamento.' : 'Dados financeiros ainda não sincronizados.'}</p>
            {(order.status === "cancelled" || order.status === "returned" || order.status === "pending") && (
              <div style={{ background:"var(--sf3)", border:"1px solid var(--bd)", borderRadius:8, padding:"10px 12px", fontSize:12, color:"var(--t2)", marginTop:4 }}>
                {cfg.msg ?? `Este pedido não é contabilizado no faturamento porque está ${cfg.label.toLowerCase()}.`}
              </div>
            )}
          </div>

          <div style={{ fontSize:11, color:"var(--t4)" }}>Última atualização: {formatDateTime(order.date)}</div>
        </div>
      </div>
    </>
  )
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
      <span style={{ fontSize:12, color:"var(--t3)" }}>{label}</span>
      <span style={{ fontSize:13, color:"var(--t1)", fontWeight:500, fontFamily:mono?"'JetBrains Mono',monospace":undefined }}>{children}</span>
    </div>
  )
}
