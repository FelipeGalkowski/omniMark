import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { registerAccounts } from './accounts.js'

const company = '2a741c2f-c591-41c3-9bc3-92db19003e1d'
const account = '4a741c2f-c591-41c3-9bc3-92db19003e1d'
const origin = 'https://teste.omnimark.tech'
async function request(options: { role?: string | null; origin?: string; authenticated?: boolean; removed?: number; exists?: boolean; accountId?: string; method?: 'DELETE' | 'PATCH'; payload?: unknown } = {}) {
  const db: any = {
    companyMember: { findUnique: vi.fn(async () => options.role === null ? null : { role: options.role ?? 'OWNER' }) },
    marketplaceAccount: {
      deleteMany: vi.fn(async () => ({ count: options.removed ?? 1 })),
      updateMany: vi.fn(async () => ({ count: options.removed ?? 1 })),
      findFirst: vi.fn(async () => options.exists ? { id: account } : null),
    },
  }
  const app = Fastify()
  registerAccounts(app, db, async (req: any, reply: any) => {
    if (options.authenticated === false) return reply.code(401).send({ error: 'Não autenticado' })
    req.currentUser = { id: 'user' }
  }, origin)
  const response = await app.inject({ method: options.method ?? 'DELETE', url: `/companies/${company}/accounts/${options.accountId ?? account}`, headers: { origin: options.origin ?? origin }, ...(options.method === 'PATCH' ? { payload: options.payload as any } : {}) })
  await app.close()
  return { response, db }
}

describe('Desconexão de contas', () => {
  it.each(['OWNER', 'ADMIN'])('permite %s e protege atomicamente a empresa e a sincronização', async role => {
    const { response, db } = await request({ role })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(db.marketplaceAccount.deleteMany).toHaveBeenCalledWith({ where: {
      id: account, companyId: company,
      OR: [{ syncLockUntil: null }, { syncLockUntil: { lte: expect.any(Date) } }],
    } })
  })
  it.each([
    [{ authenticated: false }, 401], [{ origin: 'https://outro.test' }, 403],
    [{ role: null }, 404], [{ role: 'VIEWER' }, 403], [{ accountId: 'invalid' }, 400],
  ] as const)('rejeita acesso inválido sem remover dados: %j', async (options, status) => {
    const { response, db } = await request(options)
    expect(response.statusCode).toBe(status)
    expect(db.marketplaceAccount.deleteMany).not.toHaveBeenCalled()
  })
  it('recusa remoção quando outra requisição está sincronizando', async () => {
    const { response } = await request({ removed: 0, exists: true })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('sincronização')
  })
  it('não expõe contas ausentes ou de outra empresa', async () => {
    const { response, db } = await request({ removed: 0 })
    expect(response.statusCode).toBe(404)
    expect(db.marketplaceAccount.findFirst).toHaveBeenCalledWith({ where: { id: account, companyId: company }, select: { id: true } })
  })
})

describe('Renomear contas', () => {
  it.each(['OWNER', 'ADMIN'])('permite %s e altera somente o nome da conta dentro da empresa, inclusive durante sincronização', async role => {
    const { response, db } = await request({ method: 'PATCH', payload: { name: '  Loja principal  ' }, role })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ id: account, name: 'Loja principal' })
    expect(db.marketplaceAccount.updateMany).toHaveBeenCalledWith({ where: { id: account, companyId: company }, data: { label: 'Loja principal' } })
    expect(db.marketplaceAccount.deleteMany).not.toHaveBeenCalled()
  })
  it.each([
    [{ authenticated: false }, 401], [{ origin: 'https://outro.test' }, 403],
    [{ role: null }, 404], [{ role: 'VIEWER' }, 403], [{ accountId: 'invalid' }, 400],
  ] as const)('recusa edição sem acesso válido: %j', async (options, status) => {
    const { response, db } = await request({ ...options, method: 'PATCH', payload: { name: 'Loja' } })
    expect(response.statusCode).toBe(status)
    expect(db.marketplaceAccount.updateMany).not.toHaveBeenCalled()
  })
  it.each([{ name: '   ' }, { name: 'x'.repeat(121) }, { name: 10 }, {}, { name: 'Loja\nOutra' }, { name: 'Loja', status: 'CONNECTED' }])('rejeita nome inválido ou campos adicionais: %j', async payload => {
    const { response, db } = await request({ method: 'PATCH', payload })
    expect(response.statusCode).toBe(400)
    expect(db.marketplaceAccount.updateMany).not.toHaveBeenCalled()
  })
  it('não altera contas ausentes ou de outra empresa', async () => {
    const { response } = await request({ method: 'PATCH', payload: { name: 'Loja' }, removed: 0 })
    expect(response.statusCode).toBe(404)
  })
})
