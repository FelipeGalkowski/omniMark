import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient, Prisma } from '@prisma/client'
import { registerAuthentication } from './authentication.js'
import { registerEmailWorker } from './account-email.js'
import { z } from 'zod'
import { registerMercadoLivre } from './mercadolivre.js'
import { registerMagalu } from './magalu.js'
import { registerLegalPages } from './legal.js'
import { registerOrderSync } from './order-sync.js'
import { orderSyncAdapters } from './sync-adapters.js'
import { createSyncService, registerSyncWorker } from './sync-service.js'
import { registerAccounts } from './accounts.js'
import { registerWeb, rewriteApiUrl } from './web.js'

const db = new PrismaClient()
const app = Fastify({ trustProxy: process.env.TRUST_PROXY === 'true', rewriteUrl: req => rewriteApiUrl(req.url ?? '/'), logger: { serializers: { req: req => ({ method: req.method, url: req.url?.split('?')[0] }) } } })
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
await app.register(cors, { origin, credentials: true })
await app.register(cookie)
await app.register(helmet, { contentSecurityPolicy: { directives: {
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
} } })
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
const secure = process.env.NODE_ENV === 'production'
const cookieName = secure ? '__Host-omnimark_session' : 'omnimark_session'
const authenticated = registerAuthentication(app, db, { origin, cookieName, secure })
registerEmailWorker(app, db)
const syncService = createSyncService(db, orderSyncAdapters, undefined, fetch, details => app.log.warn(details, 'ORDER_SYNC_FAILED'))
registerSyncWorker(app, syncService)
app.setErrorHandler((error, _req, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Dados inválidos', details: error.flatten() })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'Este registro já existe.' })
  const statusCode = error instanceof Error && 'statusCode' in error ? Number(error.statusCode) : 500
  if (statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send({ error: statusCode === 429 ? 'Muitas tentativas. Aguarde um minuto e tente novamente.' : 'Não foi possível processar a solicitação.' })
  app.log.error(error)
  return reply.code(500).send({ error: 'Erro interno' })
})
app.get('/health', async () => ({ status: 'ok' }))
const companyInput = z.object({ name: z.string().trim().min(2).max(120), legalName: z.string().trim().max(200).nullable().optional(), cnpj: z.string().regex(/^\d{14}$/).nullable().optional() })
app.get('/companies', { preHandler: authenticated }, async (req: any) => {
  const records = await db.company.findMany({ where: { memberships: { some: { userId: req.currentUser.id } } }, include: { _count: { select: { accounts: true } }, memberships: { where: { userId: req.currentUser.id }, select: { role: true } } }, orderBy: { createdAt: 'desc' } })
  return records.map(({ memberships, ...company }) => ({ ...company, role: memberships[0].role }))
})
app.post('/companies', { preHandler: authenticated }, async (req: any, reply) => {
  const input = companyInput.parse(req.body)
  const company = await db.company.create({ data: { ...input, memberships: { create: { userId: req.currentUser.id, role: 'OWNER' } } } })
  return reply.code(201).send(company)
})
app.patch('/companies/:id', { preHandler: authenticated }, async (req: any, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
  const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
  if (!member) return reply.code(404).send({ error: 'Empresa não encontrada' })
  if (member.role === 'VIEWER') return reply.code(403).send({ error: 'Você não tem permissão para editar esta empresa.' })
  const input = companyInput.parse(req.body)
  const company = await db.company.update({ where: { id }, data: input, include: { _count: { select: { accounts: true } } } })
  return { ...company, role: member.role }
})
app.get('/companies/:id/accounts', { preHandler: authenticated }, async (req: any, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
  const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
  if (!member) return reply.code(404).send({ error: 'Empresa não encontrada' })
  reply.header('Cache-Control', 'no-store')
  const accounts = await db.marketplaceAccount.findMany({ where: { companyId: id }, select: { id: true, marketplace: true, environment: true, label: true, status: true, createdAt: true, lastSyncAt: true, syncFrom: true, syncTo: true, syncError: true, nextSyncAt: true, syncAttemptAt: true, syncLockUntil: true } })
  return accounts.map(({ nextSyncAt, syncAttemptAt, syncLockUntil, ...account }) => {
    const synchronization = syncService.describe({ ...account, nextSyncAt, syncAttemptAt, syncLockUntil })
    return { ...account, active: synchronization.state !== 'environment_mismatch', synchronization }
  })
})
app.get('/companies/:id/dashboard', { preHandler: authenticated }, async (req: any, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
  const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
  if (!member) return reply.code(404).send({ error: 'Empresa não encontrada' })
  return { integrationStatus: 'not_connected', orders: 0, grossRevenue: null, currency: 'BRL', note: 'Sem pedidos reais sincronizados; nenhum valor demonstrativo é exibido.' }
})
registerMercadoLivre(app, db, authenticated, cookieName, origin)
registerMagalu(app, db, authenticated, cookieName, origin)
registerLegalPages(app)
registerOrderSync(app, db, authenticated, origin, syncService)
registerAccounts(app, db, authenticated, origin)
if (process.env.SERVE_WEB === 'true') await registerWeb(app, process.env.WEB_DIST_PATH ?? '../web/dist')
app.addHook('onClose', async () => { await db.$disconnect() })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close() })
const port = Number(process.env.PORT ?? 3001)
try { await app.listen({ port, host: '0.0.0.0' }) } catch (error) { app.log.error(error); process.exit(1) }
