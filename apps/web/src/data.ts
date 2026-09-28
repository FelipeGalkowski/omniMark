
export type MarketplaceId = "mercadolivre" | "magalu" | "amazon" | "shopee"
export type OrderStatus   = "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "returned"
export type AccountStatus = "pending" | "connected" | "syncing" | "error" | "reconnect_needed"
export type Page          = "overview" | "orders" | "accounts" | "myaccount"

export interface Company {
  id: string
  name: string           // display name (required)
  razaoSocial?: string
  cnpj?: string
  accountCount?: number
  canEdit?: boolean
}

export interface MarketplaceConfig {
  id: MarketplaceId
  label: string
  color: string
  bg: string
  text: string
}

export interface Account {
  id: string
  companyId: string
  marketplace: MarketplaceId
  name: string
  status: AccountStatus
  lastSync: Date | null
  errorMsg?: string
}

export interface OrderItem {
  name: string
  qty: number
  unitPrice: number
}

export interface Order {
  id: string
  companyId: string
  accountId: string
  marketplace: MarketplaceId
  date: Date
  status: OrderStatus
  items: OrderItem[]
  shipping: number
  financials?: {
    paymentConfirmed: boolean
    discount: number
    refunds: { id: string; amount: number; status: 'pending' | 'confirmed'; date: Date }[]
    returns: { id: string; status: 'requested' | 'in_progress' | 'completed' | 'cancelled' }[]
  }
}

// Fixed reference date for demo shortcuts (Este mês = Dez 2025, Mês passado = Nov 2025)
export const DEMO_NOW = new Date(2025, 11, 31, 23, 59, 59)

export function initialDateRange(demo: boolean) {
  const now = demo ? DEMO_NOW : new Date()
  return { from: new Date(now.getFullYear(), demo ? 0 : now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) }
}


export const MARKETPLACES: MarketplaceConfig[] = [
  { id: "mercadolivre", label: "Mercado Livre", color: "#FFE600", bg: "#FFFBCC", text: "#5C4B00" },
  { id: "magalu",       label: "Magalu",         color: "#0E89FF", bg: "#D6EEFF", text: "#003D75" },
  { id: "amazon",       label: "Amazon",         color: "#000000", bg: "#E8E8E8", text: "#ffffff" },
  { id: "shopee",       label: "Shopee",         color: "#EE4D2D", bg: "#FDDDD8", text: "#ffffff" },
]


export const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; color: string; dot: string; msg: string }> = {
  pending:   { label: "Pendente",   bg: "#FEF3C7", color: "#92400E", dot: "#F59E0B", msg: "Este pedido não é contabilizado no faturamento porque está pendente." },
  paid:      { label: "Pago",       bg: "#DBEAFE", color: "#1E40AF", dot: "#3B82F6", msg: "" },
  shipped:   { label: "Enviado",    bg: "#EDE9FE", color: "#5B21B6", dot: "#8B5CF6", msg: "" },
  delivered: { label: "Entregue",   bg: "#DCFCE7", color: "#166534", dot: "#22C55E", msg: "" },
  cancelled: { label: "Cancelado",  bg: "#FEE2E2", color: "#991B1B", dot: "#EF4444", msg: "Cancelamentos não geram desconto adicional. O ajuste financeiro considera os reembolsos confirmados." },
  returned:  { label: "Devolvido",  bg: "#FFEDD5", color: "#9A3412", dot: "#F97316", msg: "A venda original é preservada. Somente reembolsos confirmados reduzem as vendas após reembolsos." },
}

export const ALL_STATUSES: OrderStatus[] = ["pending", "paid", "shipped", "delivered", "cancelled", "returned"]


export const DEFAULT_COMPANIES: Company[] = [
  { id: "techstore", name: "TechStore Brasil", razaoSocial: "TechStore Comércio Eletrônico Ltda.", cnpj: "12.345.678/0001-90" },
  { id: "modacia",   name: "Moda & Cia",       razaoSocial: "Moda e Cia Indústria e Comércio S.A.", cnpj: "98.765.432/0001-10" },
]

// lastSync dates set after December 2025 orders (coherent with data timeline)

export const INITIAL_ACCOUNTS: Account[] = [
  {
    id: "ts-ml1", companyId: "techstore", marketplace: "mercadolivre",
    name: "ML Principal", status: "connected",
    lastSync: new Date("2025-12-31T23:15:00"),
  },
  {
    id: "ts-ml2", companyId: "techstore", marketplace: "mercadolivre",
    name: "ML Importados", status: "connected",
    lastSync: new Date("2025-12-31T22:48:00"),
  },
  {
    id: "ts-mg1", companyId: "techstore", marketplace: "magalu",
    name: "Magalu Tech", status: "connected",
    lastSync: new Date("2025-12-31T23:10:00"),
  },
  {
    id: "ts-az1", companyId: "techstore", marketplace: "amazon",
    name: "Amazon BR", status: "error",
    lastSync: new Date("2025-12-28T14:20:00"),
    errorMsg: "Token de acesso expirado. Reconecte a conta.",
  },
  {
    id: "ts-sh1", companyId: "techstore", marketplace: "shopee",
    name: "Shopee Tech", status: "connected",
    lastSync: new Date("2025-12-31T23:05:00"),
  },
  {
    id: "mc-ml1", companyId: "modacia", marketplace: "mercadolivre",
    name: "ML Moda", status: "connected",
    lastSync: new Date("2025-12-31T23:20:00"),
  },
  {
    id: "mc-az1", companyId: "modacia", marketplace: "amazon",
    name: "Amazon Fashion", status: "reconnect_needed",
    lastSync: new Date("2025-12-26T09:10:00"),
    errorMsg: "Reconexão necessária. Credenciais revogadas pelo marketplace.",
  },
]


const CATALOG: Record<string, Array<{ name: string; min: number; max: number }>> = {
  "ts-ml1": [
    { name: "Fone Bluetooth JBL T510",       min: 189, max: 279 },
    { name: "Cabo USB-C 2m Reforçado",        min: 39,  max: 69  },
    { name: "Carregador Rápido 65W",          min: 129, max: 199 },
    { name: "Hub USB-C 7 em 1",              min: 149, max: 239 },
    { name: "Película 3D iPhone 15",         min: 29,  max: 49  },
    { name: "Suporte Veicular Magnético",    min: 59,  max: 89  },
    { name: "Caixa de Som Portátil 20W",     min: 219, max: 369 },
    { name: "Smartwatch X5 Pro",             min: 289, max: 459 },
  ],
  "ts-ml2": [
    { name: "Drone DJI Mini 3",              min: 1890, max: 2790 },
    { name: "Câmera GoPro Hero 12",          min: 1390, max: 1890 },
    { name: "Teclado Mecânico Keychron K2",  min: 590,  max: 890  },
    { name: "Headphone Sony WH-1000XM5",     min: 1290, max: 1790 },
    { name: "Monitor 4K 27\" LG",           min: 1590, max: 2490 },
  ],
  "ts-mg1": [
    { name: "Air Fryer 4L Digital",          min: 259, max: 429 },
    { name: "Aspirador Robô Smart",          min: 389, max: 689 },
    { name: "Panela de Pressão Elétrica 5L", min: 189, max: 319 },
    { name: "Ferro de Passar a Vapor 2400W", min: 129, max: 219 },
    { name: "Liquidificador 900W",           min: 149, max: 269 },
    { name: "Cafeteira Expresso 15 Bar",     min: 319, max: 589 },
  ],
  "ts-az1": [
    { name: "SSD Externo 1TB Samsung T7",    min: 389, max: 589 },
    { name: "Mouse Sem Fio Logitech MX3",    min: 289, max: 449 },
    { name: "Webcam Full HD 1080p",          min: 219, max: 379 },
    { name: "Headset Gamer 7.1 Surround",    min: 249, max: 489 },
    { name: "Teclado Gamer RGB Corsair",     min: 319, max: 579 },
  ],
  "ts-sh1": [
    { name: "Capa Protetora iPhone 15",      min: 25,  max: 55  },
    { name: "Carregador 20W Compatível",     min: 35,  max: 69  },
    { name: "Óculos de Sol Polarizado",      min: 49,  max: 119 },
    { name: "Mochila Notebook 15.6\"",       min: 89,  max: 159 },
    { name: "Caneta Stylus Universal",       min: 29,  max: 55  },
    { name: "Relógio Digital Esportivo",     min: 89,  max: 169 },
  ],
  "mc-ml1": [
    { name: "Camiseta Básica Premium",       min: 89,  max: 169 },
    { name: "Calça Jeans Slim Fit",          min: 189, max: 319 },
    { name: "Vestido Floral Midi",           min: 219, max: 379 },
    { name: "Tênis Casual Feminino",         min: 189, max: 349 },
    { name: "Blusa Cropped Algodão",         min: 79,  max: 149 },
    { name: "Shorts Jeans Destroyed",        min: 129, max: 229 },
    { name: "Conjunto Moletom",              min: 219, max: 389 },
  ],
  "mc-az1": [
    { name: "Blazer Feminino Alfaiataria",   min: 289, max: 489 },
    { name: "Vestido Midi Elegante",         min: 319, max: 589 },
    { name: "Calça Wide Leg Premium",        min: 249, max: 429 },
    { name: "Blusa de Seda Premium",         min: 199, max: 369 },
    { name: "Conjunto Alfaiataria Completo", min: 489, max: 789 },
  ],
}


function createRng(seed: number) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}


const MONTH_MULT = [0.85, 0.75, 0.90, 0.88, 0.95, 1.00, 0.90, 1.00, 0.95, 1.05, 1.60, 0.85]

function pickStatus(rng: () => number, monthIndex: number, year: number): OrderStatus {
  const age = year < 2025 ? 24 : 11 - monthIndex
  if (age >= 8) {
    const r = rng()
    return r < 0.82 ? "delivered" : r < 0.93 ? "cancelled" : "returned"
  } else if (age >= 4) {
    const r = rng()
    if (r < 0.62) return "delivered"
    if (r < 0.80) return "shipped"
    if (r < 0.87) return "paid"
    if (r < 0.95) return "cancelled"
    return "returned"
  } else {
    const r = rng()
    if (r < 0.38) return "delivered"
    if (r < 0.60) return "shipped"
    if (r < 0.75) return "paid"
    if (r < 0.87) return "pending"
    if (r < 0.95) return "cancelled"
    return "returned"
  }
}

interface AccountConfig {
  id: string
  companyId: string
  marketplace: MarketplaceId
  base: number
}

const ACCOUNT_CONFIGS: AccountConfig[] = [
  { id: "ts-ml1", companyId: "techstore", marketplace: "mercadolivre", base: 28 },
  { id: "ts-ml2", companyId: "techstore", marketplace: "mercadolivre", base: 8  },
  { id: "ts-mg1", companyId: "techstore", marketplace: "magalu",       base: 14 },
  { id: "ts-az1", companyId: "techstore", marketplace: "amazon",       base: 9  },
  { id: "ts-sh1", companyId: "techstore", marketplace: "shopee",       base: 22 },
  { id: "mc-ml1", companyId: "modacia",   marketplace: "mercadolivre", base: 18 },
  { id: "mc-az1", companyId: "modacia",   marketplace: "amazon",       base: 6  },
]

function generateOrders(): Order[] {
  const orders: Order[] = []
  let seq = 10000

  for (const cfg of ACCOUNT_CONFIGS) {
    const seed = cfg.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
    const rng  = createRng(seed)
    const products = CATALOG[cfg.id]!

    for (let m = 0; m < 12; m++) {
      const count = Math.round(cfg.base * MONTH_MULT[m] * (0.75 + rng() * 0.5))
      for (let i = 0; i < count; i++) {
        const day  = Math.floor(rng() * 27) + 1
        const hr   = Math.floor(rng() * 14) + 8
        const min  = Math.floor(rng() * 60)
        const date = new Date(2025, m, day, hr, min)
        const status = pickStatus(rng, m, 2025)
        const itemCount = rng() < 0.7 ? 1 : rng() < 0.8 ? 2 : 3
        const items: OrderItem[] = []
        for (let j = 0; j < itemCount; j++) {
          const p = products[Math.floor(rng() * products.length)]
          const price = Math.round(p.min + rng() * (p.max - p.min))
          items.push({ name: p.name, qty: 1, unitPrice: price })
        }
        orders.push({
          id: `PED-${String(++seq).padStart(6, "0")}`,
          companyId: cfg.companyId,
          accountId: cfg.id,
          marketplace: cfg.marketplace,
          date,
          status,
          items,
          shipping: status === "cancelled" ? 0 : Math.round(12 + rng() * 28),
        })
      }
    }

    // Full previous year provides a complete comparison baseline in the demo.
    for (let m = 0; m < 12; m++) {
      const count = Math.round(cfg.base * MONTH_MULT[m] * 0.82 * (0.75 + rng() * 0.5))
      for (let i = 0; i < count; i++) {
        const day  = Math.floor(rng() * 27) + 1
        const date = new Date(2024, m, day, Math.floor(rng() * 14) + 8, Math.floor(rng() * 60))
        const p    = products[Math.floor(rng() * products.length)]
        const price = Math.round(p.min + rng() * (p.max - p.min))
        const r    = rng()
        orders.push({
          id: `PED-${String(++seq).padStart(6, "0")}`,
          companyId: cfg.companyId,
          accountId: cfg.id,
          marketplace: cfg.marketplace,
          date,
          status: r < 0.80 ? "delivered" : r < 0.92 ? "cancelled" : "returned",
          items: [{ name: p.name, qty: 1, unitPrice: price }],
          shipping: Math.round(12 + rng() * 28),
        })
      }
    }
  }

  return orders.sort((a, b) => b.date.getTime() - a.date.getTime())
}

export const ALL_ORDERS: Order[] = generateOrders().map((order, index) => {
  const paymentConfirmed = order.status !== 'pending' && (order.status !== 'cancelled' || index % 2 === 0)
  const discount = paymentConfirmed && index % 7 === 0 ? 10 : 0
  const total = Math.round((orderItemsTotal(order) - discount + order.shipping) * 100) / 100
  const refunded = paymentConfirmed && (order.status === 'returned' || order.status === 'cancelled')
  const partial = order.status === 'delivered' && index % 13 === 0
  const requested = order.status === 'delivered' && !partial && index % 17 === 0
  return { ...order, financials: {
    paymentConfirmed, discount,
    refunds: refunded || partial ? [{ id: `demo-refund-${order.id}`, amount: partial ? Math.round(total * 25) / 100 : total, status: 'confirmed' as const, date: new Date(Math.min(DEMO_NOW.getTime(), order.date.getTime() + 5 * 86400000)) }] : [],
    returns: order.status === 'returned' ? [{ id: `demo-return-${order.id}`, status: 'completed' as const }] : requested ? [{ id: `demo-return-${order.id}`, status: 'requested' as const }] : [],
  } }
})


export function orderItemsTotal(o: Order): number {
  return o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
}

export function countedInRevenue(o: Order): boolean {
  return o.financials?.paymentConfirmed === true
}

export function getMonthsInRange(from: Date, to: Date): Array<{ label: string; year: number; month: number }> {
  const result = []
  const cur = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)
  while (cur <= end) {
    result.push({
      label: cur.toLocaleString("pt-BR", { month: "short" }),
      year: cur.getFullYear(),
      month: cur.getMonth(),
    })
    cur.setMonth(cur.getMonth() + 1)
  }
  return result
}


/** Full BRL, 0 decimals — for KPI cards */
export function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v)
}

/** Full BRL, 2 decimals — for tables, panels, tooltips */
export function formatBRLFull(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

/** Abbreviated BRL in Portuguese — "R$ 244,7 mil" / "R$ 1,2 mi" — for axes/cards */
export function formatBRLShort(v: number): string {
  if (v >= 1_000_000) {
    const s = (v / 1_000_000).toFixed(1).replace(".", ",")
    return `R$ ${s} mi`
  }
  if (v >= 1_000) {
    const s = (v / 1_000).toFixed(1).replace(".", ",")
    return `R$ ${s} mil`
  }
  return formatBRLFull(v)
}

/** Percentage with Portuguese decimal separator — "65,4%" */
export function formatPct(v: number): string {
  return v.toFixed(1).replace(".", ",") + "%"
}

/** Growth with sign and arrow — "+12,3%" or "-4,5%" */
export function formatGrowth(v: number): string {
  const abs = Math.abs(v).toFixed(1).replace(".", ",")
  return `${v >= 0 ? "+" : "-"}${abs}%`
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function formatDateTime(d: Date | null): string {
  if (!d) return "Ainda não sincronizada"
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** Checks digit count only; does not validate CNPJ check digits. */
export function validateCNPJ(v: string): boolean {
  const digits = v.replace(/\D/g, "")
  if (digits.length !== 14) return false
  return true
}

export function formatCNPJ(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}
