import { Icon } from './Icon'
import { useState, useMemo } from "react"
import { useAuth } from "./auth"
import { orderSale, confirmedRefunds } from './kpis'
import Dialog from './Dialog'
import {
  initialDateRange, MARKETPLACES, ALL_STATUSES, STATUS_CONFIG,
  orderItemsTotal,
  formatBRLFull, formatDate, formatDateTime,
  type Account, type Order, type OrderStatus, type MarketplaceId,
} from "./data"
import {
  DateRangePicker, AccountDropdown, MarketplaceDropdown, StatusDropdown, SandboxNotice,
  StatusBadge, EmptyState, btnSec, btnPri, MarketplaceDot,
} from "./ui"

const PAGE_SIZE    = 20

interface OrdersPageProps {
  companyId: string
  accounts: Account[]
  orders: Order[]
  loading?: boolean
  loadError?: boolean
  onRetry?: () => void
}

export default function OrdersPage({ companyId, accounts, orders, loading = false, loadError = false, onRetry }: OrdersPageProps) {
  const { user } = useAuth()
  const defaults = useMemo(() => initialDateRange(user.isDemoUser), [user.isDemoUser])
  const companyAccounts = accounts.filter(a => a.companyId === companyId && a.active !== false)
  const allAccountIds   = companyAccounts.map(a => a.id)

  const [dateRange,     setDateRange]     = useState(defaults)
  const [selMarkets,    setSelMarkets]    = useState<MarketplaceId[]>(MARKETPLACES.map(m => m.id))
  const [selAccounts,   setSelAccounts]   = useState<string[] | null>(null)
  const [selStatuses,   setSelStatuses]   = useState<OrderStatus[]>([...ALL_STATUSES])
  const [search,        setSearch]        = useState("")
  const [page,          setPage]          = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const effectiveAccounts = (selAccounts ?? allAccountIds).filter(id => allAccountIds.includes(id))

  function toggleMarket(id: MarketplaceId)  { setSelMarkets(p => p.includes(id) ? (p.length>1?p.filter(x=>x!==id):p) : [...p,id]); setPage(1) }
  function toggleAccount(id: string)         { setSelAccounts(p => (p ?? allAccountIds).includes(id) ? (p ?? allAccountIds).filter(x=>x!==id) : [...(p ?? allAccountIds),id]); setPage(1) }
  function toggleStatus(s: OrderStatus)      { setSelStatuses(p => p.includes(s) ? p.filter(x=>x!==s) : [...p,s]); setPage(1) }

  function clearFilters() {
    setDateRange(defaults)
    setSelMarkets(MARKETPLACES.map(m => m.id))
    setSelAccounts(null)
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
      o.date < new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate() + 1) &&
      (term === "" || o.id.toLowerCase().includes(term))
    )
  }, [orders, companyId, effectiveAccounts, selMarkets, selStatuses, dateRange, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageOrders = filtered.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE)
  const hasImportedOrders = orders.some(order => order.companyId === companyId && allAccountIds.includes(order.accountId))

  return (
    <div className="page-body" style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:16, position:"relative" }}>
      <SandboxNotice accounts={companyAccounts} />
      {loadError && hasImportedOrders && <div className="app-alert app-alert--warning" role="status">Não foi possível atualizar os pedidos. Exibindo a última consulta disponível.{onRetry && <button style={btnSec} onClick={onRetry}>Tentar novamente</button>}</div>}

      <div style={{ background:"var(--sf)", border:"1px solid var(--bd)", borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flexShrink:0 }}>
          <input
            aria-label="Buscar por número do pedido"
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
          <strong style={{ color:"var(--t2)" }}>{filtered.length.toLocaleString("pt-BR")}</strong> pedidos encontrados · página {currentPage} de {totalPages}
        </div>
      )}

      {loading ? <div role="status"><EmptyState icon="clock" title="Carregando pedidos" desc="Consultando os pedidos e as contas desta empresa." /></div>
      : loadError && !hasImportedOrders ? <EmptyState icon="alert" title="Não foi possível carregar os pedidos" desc="Tente consultar os pedidos novamente." action={onRetry && <button onClick={onRetry} style={btnSec}>Tentar novamente</button>} />
      : filtered.length === 0 ? (
        <EmptyState icon="orders" title={hasImportedOrders || user.isDemoUser ? "Nenhum pedido encontrado" : "Nenhum pedido sincronizado"} desc={hasImportedOrders || user.isDemoUser ? "Ajuste os filtros ou a busca para encontrar pedidos." : "A primeira importação começa após conectar uma loja. Confira o andamento em Contas."} action={<button onClick={clearFilters} style={btnPri}>Limpar filtros</button>} />
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
                    <td style={{ padding:"12px 14px", fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--t2)", whiteSpace:"nowrap" }}><button className="order-details-trigger" aria-label={`Ver pedido ${o.id}`} onClick={event => { event.stopPropagation(); setSelectedOrder(o) }}>{o.id}</button></td>
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
                      {orderItemsTotal(o) === null ? '—' : formatBRLFull(orderItemsTotal(o)!)}
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
          <button onClick={() => setPage(Math.max(1,currentPage-1))} disabled={currentPage===1} style={{ ...btnSec, padding:"5px 12px", fontSize:12, opacity:currentPage===1?0.4:1 }}><Icon name="arrowLeft" /> Anterior</button>
          {Array.from({length:Math.min(7,totalPages)},(_,i) => {
            const p = totalPages <= 7 ? i+1 : currentPage <= 4 ? i+1 : currentPage >= totalPages-3 ? totalPages-6+i : currentPage-3+i
            return (
              <button key={p} onClick={() => setPage(p)} style={{ width:32, height:32, borderRadius:7, border:"1.5px solid", borderColor:currentPage===p?"var(--t1)":"var(--bd)", background:currentPage===p?"var(--pri)":"transparent", color:currentPage===p?"var(--pri-t)":"var(--t2)", fontSize:13, fontWeight:currentPage===p?700:400, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>{p}</button>
            )
          })}
          <button onClick={() => setPage(Math.min(totalPages,currentPage+1))} disabled={currentPage===totalPages} style={{ ...btnSec, padding:"5px 12px", fontSize:12, opacity:currentPage===totalPages?0.4:1 }}>Próxima <Icon name="arrowRight" /></button>
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
    <Dialog label={`Detalhes do pedido ${order.id}`} onClose={onClose} panel>
        <div style={{ padding:"18px 22px", borderBottom:"1px solid var(--bd)", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:"var(--t3)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Detalhes do pedido</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:700, color:"var(--t1)", marginTop:4, overflowWrap:'anywhere' }}>{order.id}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6 }}>
              <StatusBadge status={order.status} />
              <span style={{ fontSize:12, color:"var(--t3)" }}>{formatDateTime(order.date)}</span>
            </div>
          </div>
          <button aria-label="Fechar detalhes do pedido" onClick={onClose} style={{ width:28, height:28, borderRadius:7, border:"1.5px solid var(--bd)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"var(--t3)" }}>
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
            <ul aria-label="Itens do pedido" style={{ listStyle:"none", padding:0, margin:0, display:"flex", flexDirection:"column", gap:12 }}>
              {order.items.map((item, i) => (
                <li key={i} style={{ border:"1px solid var(--bd)", borderRadius:10, padding:14, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)", lineHeight:1.5, overflowWrap:"anywhere" }}>{item.name}</div>
                  <dl style={{ display:"flex", flexWrap:"wrap", gap:"12px 20px", margin:"14px 0 0" }}>
                    {[
                      ['Quantidade', item.qty.toLocaleString('pt-BR')],
                      ['Valor unitário', item.unitPrice === null ? '—' : formatBRLFull(item.unitPrice)],
                      ['Total do item', item.unitPrice === null ? '—' : formatBRLFull(item.qty * item.unitPrice)],
                    ].map(([label, value]) => (
                      <div key={label} style={{ flex:"1 0 auto", maxWidth:"100%" }}>
                        <dt style={{ fontSize:11, color:"var(--t3)", marginBottom:5 }}>{label}</dt>
                        <dd style={{ margin:0, fontSize:12, color:"var(--t1)", fontWeight:label === 'Total do item' ? 700 : 500, fontFamily:"'JetBrains Mono',monospace", overflowWrap:"anywhere" }}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ borderTop:"1px solid var(--bd)", paddingTop:12, display:"flex", flexDirection:"column", gap:6 }}>
            <Row label={order.financials?.productsTotal !== undefined ? 'Produtos após descontos' : 'Subtotal (produtos)'} mono>{(order.financials?.productsTotal ?? itemsTotal) === null ? '—' : formatBRLFull((order.financials?.productsTotal ?? itemsTotal)!)}</Row>
            {order.financials?.productsTotal === undefined && <Row label="Descontos" mono>{order.financials && order.financials.discountKnown !== false ? formatBRLFull(order.financials.discount) : '—'}</Row>}
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
    </Dialog>
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
