import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient, Prisma } from '@prisma/client'
import { randomBytes, createHash } from 'node:crypto'
import argon2 from 'argon2'
import { z } from 'zod'
import { registerMercadoLivre } from './mercadolivre.js'
import { registerOrderSync } from './order-sync.js'
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
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const publicUser = (u: { id: string; name: string; email: string }) => ({ id: u.id, name: u.name, email: u.email })
async function newSession(userId: string, reply: any) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 86400_000)
  await db.session.create({ data: { userId, tokenHash: hash(token), expiresAt } })
  reply.setCookie(cookieName, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: expiresAt })
}
async function authenticated(req: any, reply: any) {
  const token = req.cookies[cookieName]
  if (!token) return reply.code(401).send({ error: 'Não autenticado' })
  const session = await db.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
  req.currentUser = session.user
}
const credentials = z.object({ email: z.string().email().max(254).transform(s => s.trim().toLowerCase()), password: z.string().min(10).max(128) })
app.setErrorHandler((error, _req, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Dados inválidos', details: error.flatten() })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'Este registro já existe.' })
  const statusCode = error instanceof Error && 'statusCode' in error ? Number(error.statusCode) : 500
  if (statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send({ error: statusCode === 429 ? 'Muitas tentativas. Aguarde um minuto e tente novamente.' : 'Não foi possível processar a solicitação.' })
  app.log.error(error)
  return reply.code(500).send({ error: 'Erro interno' })
})
app.get('/health', async () => ({ status: 'ok' }))
app.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const input = credentials.extend({ name: z.string().trim().min(2).max(120) }).parse(req.body)
  if (await db.user.findUnique({ where: { email: input.email } })) return reply.code(409).send({ error: 'E-mail já cadastrado' })
  const user = await db.user.create({ data: { name: input.name, email: input.email, passwordHash: await argon2.hash(input.password) } })
  await newSession(user.id, reply)
  return reply.code(201).send({ user: publicUser(user) })
})
app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const input = credentials.parse(req.body)
  const user = await db.user.findUnique({ where: { email: input.email } })
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) return reply.code(401).send({ error: 'Credenciais inválidas' })
  await newSession(user.id, reply)
  return { user: publicUser(user) }
})
app.get('/auth/me', { preHandler: authenticated }, async (req: any) => ({ user: publicUser(req.currentUser) }))
app.patch('/auth/me', { preHandler: authenticated }, async (req: any) => {
  const input = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body)
  const user = await db.user.update({ where: { id: req.currentUser.id }, data: input })
  return { user: publicUser(user) }
})
app.patch('/auth/password', { preHandler: authenticated, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => {
  const input = z.object({ currentPassword: z.string().min(1).max(128), password: z.string().min(10).max(128) }).parse(req.body)
  if (!(await argon2.verify(req.currentUser.passwordHash, input.currentPassword))) return reply.code(400).send({ error: 'Senha atual incorreta.' })
  const passwordHash = await argon2.hash(input.password)
  await db.$transaction([
    db.user.update({ where: { id: req.currentUser.id }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId: req.currentUser.id, tokenHash: { not: hash(req.cookies[cookieName]) } } }),
  ])
  return { ok: true }
})
app.post('/auth/logout', { preHandler: authenticated }, async (req: any, reply) => {
  await db.session.deleteMany({ where: { tokenHash: hash(req.cookies[cookieName]) } })
  reply.clearCookie(cookieName, { path: '/' })
  return { ok: true }
})
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
  return db.marketplaceAccount.findMany({ where: { companyId: id }, select: { id: true, marketplace: true, label: true, status: true, createdAt: true, lastSyncAt: true, syncFrom: true, syncTo: true, syncError: true } })
})
app.get('/companies/:id/dashboard', { preHandler: authenticated }, async (req: any, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
  const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
  if (!member) return reply.code(404).send({ error: 'Empresa não encontrada' })
  return { integrationStatus: 'not_connected', orders: 0, grossRevenue: null, currency: 'BRL', note: 'Sem pedidos reais sincronizados; nenhum valor demonstrativo é exibido.' }
})
registerMercadoLivre(app, db, authenticated, cookieName, origin)
registerOrderSync(app, db, authenticated, origin)
if (process.env.SERVE_WEB === 'true') await registerWeb(app, process.env.WEB_DIST_PATH ?? '../web/dist')
app.addHook('onClose', async () => { await db.$disconnect() })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close() })
const port = Number(process.env.PORT ?? 3001)
try { await app.listen({ port, host: '0.0.0.0' }) } catch (error) { app.log.error(error); process.exit(1) }
