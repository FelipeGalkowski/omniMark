import { formatCNPJ, type Company, type Account, type MarketplaceId, type Order } from './data'
import type { User } from './auth'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch('/api' + path, { credentials: 'include', ...init, headers })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError('Não foi possível acessar o servidor. Verifique sua conexão e tente novamente.', 0)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(data?.error ?? 'Não foi possível concluir a solicitação.', response.status)
  return data as T
}

export type UserRecord = Omit<User, 'isDemoUser'>
export type CompanyRecord = { id: string; name: string; legalName?: string | null; cnpj?: string | null; _count?: { accounts: number }; role?: 'OWNER' | 'ADMIN' | 'VIEWER' }
export function companyFromApi(record: CompanyRecord): Company {
  return { id: record.id, name: record.name, razaoSocial: record.legalName ?? undefined, cnpj: record.cnpj ? formatCNPJ(record.cnpj) : undefined, accountCount: record._count?.accounts, canEdit: record.role !== 'VIEWER' }
}
export function companyPayload(company: Pick<Company, 'name' | 'razaoSocial' | 'cnpj'>) {
  return { name: company.name.trim(), legalName: company.razaoSocial?.trim() || null, cnpj: company.cnpj?.replace(/\D/g, '') || null }
}
export async function createCompany(company: Pick<Company, 'name' | 'razaoSocial' | 'cnpj'>) {
  return companyFromApi(await api<CompanyRecord>('/companies', { method: 'POST', body: JSON.stringify(companyPayload(company)) }))
}
const marketplaces: Record<string, MarketplaceId> = { MERCADO_LIVRE: 'mercadolivre', SHOPEE: 'shopee', AMAZON: 'amazon', MAGALU: 'magalu' }
export type AccountRecord = { id: string; marketplace: string; label: string; status: 'PENDING' | 'CONNECTED' | 'EXPIRED' | 'ERROR'; lastSyncAt?: string | null; syncFrom?: string | null; syncTo?: string | null; syncError?: string | null }
export function accountFromApi(record: AccountRecord, companyId: string): Account {
  const marketplace = marketplaces[record.marketplace]
  if (!marketplace) throw new Error('Marketplace não reconhecido.')
  return { id: record.id, companyId, marketplace, name: record.label, status: { PENDING: 'pending', CONNECTED: 'connected', EXPIRED: 'reconnect_needed', ERROR: 'error' }[record.status] as Account['status'], lastSync: record.lastSyncAt ? new Date(record.lastSyncAt) : null, syncFrom: record.syncFrom ? new Date(record.syncFrom) : null, syncTo: record.syncTo ? new Date(record.syncTo) : null, errorMsg: record.syncError ?? undefined }
}

export type OrderRecord = Omit<Order, 'date' | 'financials'> & { date: string; financials?: (Omit<NonNullable<Order['financials']>, 'refunds'> & { refunds: { id: string; amount: number; status: 'pending' | 'confirmed'; date: string }[] }) | null }
export function orderFromApi(record: OrderRecord): Order {
  return { ...record, date: new Date(record.date), financials: record.financials ? { ...record.financials, refunds: record.financials.refunds.map(refund => ({ ...refund, date: new Date(refund.date) })) } : undefined }
}
