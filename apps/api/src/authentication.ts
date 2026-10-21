import { randomBytes, timingSafeEqual } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import type { PrismaClient, User } from '@prisma/client'
import type { FastifyInstance, FastifyReply } from 'fastify'
import argon2 from 'argon2'
import { z } from 'zod'
import { claimEmailThrottle, digest, emailConfiguration, queueChallenge, queuePasswordNotice, verificationHash } from './account-email.js'

const emailInput = z.string().trim().email().max(254).transform(value => value.toLowerCase())
const passwordInput = z.string().min(10).max(128)
const credentials = z.object({ email: emailInput, password: passwordInput })
const publicUser = (user: User) => ({ id: user.id, name: user.name, email: user.email, emailVerified: !!user.emailVerifiedAt })
const verificationResponse = (email: string) => ({ verificationRequired: true, email, resendAfter: 60 })
const requestResponse = { message: 'Se houver uma conta elegível para este e-mail, enviaremos as instruções. Confira também a pasta de spam.', resendAfter: 60 }
const limits = (max = 5) => ({ rateLimit: { max, timeWindow: '1 minute' } })
class InvalidChallenge extends Error {}

export function registerAuthentication(app: FastifyInstance, db: PrismaClient, options: { origin: string; cookieName: string; secure: boolean }) {
  const { origin, cookieName, secure } = options
  const trustedOrigin = async (req: any, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store')
    if (req.headers.origin !== origin) return reply.code(403).send({ error: 'Origem não permitida.' })
  }
  function mailReady(reply: FastifyReply) {
    try { emailConfiguration(); return true } catch {
      reply.code(503).send({ error: 'O envio de e-mails ainda não está configurado. Tente novamente mais tarde.' }); return false
    }
  }
  async function newSession(user: User, reply: FastifyReply) {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 86400_000)
    await db.session.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt, authVersion: user.authVersion } })
    reply.setCookie(cookieName, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: expiresAt })
  }
  async function authenticated(req: any, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store')
    const token = req.cookies[cookieName]
    if (!token) return reply.code(401).send({ error: 'Não autenticado' })
    const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } })
    if (!session || session.expiresAt <= new Date() || session.authVersion !== session.user.authVersion) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    req.currentUser = session.user
  }

  app.post('/auth/register', { preHandler: trustedOrigin, config: limits() }, async (req, reply) => {
    const input = credentials.extend({ name: z.string().trim().min(2).max(120) }).parse(req.body)
    if (!mailReady(reply)) return
    const existing = await db.user.findUnique({ where: { email: input.email } })
    if (existing) {
      if (existing.emailVerifiedAt || !(await argon2.verify(existing.passwordHash, input.password))) return reply.code(409).send({ error: 'E-mail já cadastrado. Entre na conta ou use a recuperação de senha.' })
      if (await claimEmailThrottle(db, existing.email, 'VERIFY_EMAIL')) await db.$transaction(tx => queueChallenge(tx, existing, 'VERIFY_EMAIL'))
      return verificationResponse(existing.email)
    }
    if (!(await claimEmailThrottle(db, input.email, 'VERIFY_EMAIL'))) return reply.code(429).send({ error: 'Aguarde um minuto antes de tentar novamente.' })
    const passwordHash = await argon2.hash(input.password)
    await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } })
      await queueChallenge(tx, user, 'VERIFY_EMAIL')
    })
    // No dashboard session until mailbox ownership has been established.
    return reply.code(201).send(verificationResponse(input.email))
  })

  app.post('/auth/login', { preHandler: trustedOrigin, config: limits() }, async (req, reply) => {
    const input = credentials.parse(req.body)
    const user = await db.user.findUnique({ where: { email: input.email } })
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) return reply.code(401).send({ error: 'Credenciais inválidas' })
    if (!user.emailVerifiedAt) {
      if (!mailReady(reply)) return
      if (await claimEmailThrottle(db, user.email, 'VERIFY_EMAIL')) await db.$transaction(tx => queueChallenge(tx, user, 'VERIFY_EMAIL'))
      return verificationResponse(user.email)
    }
    await newSession(user, reply)
    return { user: publicUser(user) }
  })

  app.post('/auth/email/request', { preHandler: trustedOrigin, config: limits() }, async (req, reply) => {
    const { email } = z.object({ email: emailInput }).parse(req.body)
    if (!mailReady(reply)) return
    const started = Date.now()
    const allowed = await claimEmailThrottle(db, email, 'VERIFY_EMAIL')
    const user = await db.user.findUnique({ where: { email } })
    if (allowed && user && !user.emailVerifiedAt) await db.$transaction(tx => queueChallenge(tx, user, 'VERIFY_EMAIL'))
    await pause(Math.max(0, 150 - (Date.now() - started)))
    return requestResponse
  })

  app.post('/auth/email/verify', { preHandler: trustedOrigin, config: limits(10) }, async (req, reply) => {
    const { email, code } = z.object({ email: emailInput, code: z.string().regex(/^\d{6}$/) }).parse(req.body)
    const user = await db.user.findUnique({ where: { email } })
    const challenge = user ? await db.emailChallenge.findUnique({ where: { userId_purpose: { userId: user.id, purpose: 'VERIFY_EMAIL' } } }) : null
    const invalid = () => reply.code(400).send({ error: 'Código inválido ou expirado. Solicite outro código se necessário.' })
    if (!user || !challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5) return invalid()
    const expected = Buffer.from(verificationHash(user.id, challenge.id, code), 'hex')
    const stored = Buffer.from(challenge.tokenHash, 'hex')
    if (expected.length !== stored.length || !timingSafeEqual(expected, stored)) {
      await db.emailChallenge.updateMany({ where: { id: challenge.id, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 } } })
      return invalid()
    }
    try {
      await db.$transaction(async tx => {
        const consumed = await tx.emailChallenge.deleteMany({ where: { id: challenge.id, attempts: { lt: 5 }, expiresAt: { gt: new Date() } } })
        if (!consumed.count) throw new InvalidChallenge()
        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })
      })
    } catch (error) { if (error instanceof InvalidChallenge) return invalid(); throw error }
    return { ok: true }
  })

  app.post('/auth/password/request', { preHandler: trustedOrigin, config: limits() }, async (req, reply) => {
    const { email } = z.object({ email: emailInput }).parse(req.body)
    if (!mailReady(reply)) return
    const started = Date.now()
    const allowed = await claimEmailThrottle(db, email, 'RESET_PASSWORD')
    const user = await db.user.findUnique({ where: { email } })
    if (allowed && user) await db.$transaction(tx => queueChallenge(tx, user, 'RESET_PASSWORD'))
    await pause(Math.max(0, 150 - (Date.now() - started)))
    return requestResponse
  })

  app.post('/auth/password/reset', { preHandler: trustedOrigin, config: limits() }, async (req, reply) => {
    const { token, password } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordInput }).parse(req.body)
    const challenge = await db.emailChallenge.findUnique({ where: { tokenHash: digest(token) } })
    const invalid = () => reply.code(400).send({ error: 'Link inválido ou expirado. Solicite uma nova recuperação de senha.' })
    if (!challenge || challenge.purpose !== 'RESET_PASSWORD' || challenge.expiresAt <= new Date()) return invalid()
    const passwordHash = await argon2.hash(password)
    try {
      await db.$transaction(async tx => {
        const consumed = await tx.emailChallenge.deleteMany({ where: { id: challenge.id, purpose: 'RESET_PASSWORD', expiresAt: { gt: new Date() } } })
        if (!consumed.count) throw new InvalidChallenge()
        const user = await tx.user.update({ where: { id: challenge.userId }, data: { passwordHash, emailVerifiedAt: new Date(), authVersion: { increment: 1 } } })
        await tx.session.deleteMany({ where: { userId: user.id } })
        await tx.emailChallenge.deleteMany({ where: { userId: user.id } })
        await queuePasswordNotice(tx, user)
      })
    } catch (error) { if (error instanceof InvalidChallenge) return invalid(); throw error }
    reply.clearCookie(cookieName, { path: '/' })
    return { ok: true }
  })

  app.get('/auth/me', { preHandler: authenticated }, async (req: any) => ({ user: publicUser(req.currentUser) }))
  app.patch('/auth/me', { preHandler: authenticated }, async (req: any) => {
    const input = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body)
    const user = await db.user.update({ where: { id: req.currentUser.id }, data: input })
    return { user: publicUser(user) }
  })
  app.patch('/auth/password', { preHandler: [trustedOrigin, authenticated], config: limits() }, async (req: any, reply) => {
    const input = z.object({ currentPassword: z.string().min(1).max(128), password: passwordInput }).parse(req.body)
    if (!(await argon2.verify(req.currentUser.passwordHash, input.currentPassword))) return reply.code(400).send({ error: 'Senha atual incorreta.' })
    const passwordHash = await argon2.hash(input.password)
    try {
      await db.$transaction(async tx => {
        const changed = await tx.user.updateMany({ where: { id: req.currentUser.id, authVersion: req.currentUser.authVersion }, data: { passwordHash, authVersion: { increment: 1 } } })
        if (!changed.count) throw new InvalidChallenge()
        const currentHash = digest(req.cookies[cookieName])
        await tx.session.deleteMany({ where: { userId: req.currentUser.id, tokenHash: { not: currentHash } } })
        await tx.session.updateMany({ where: { userId: req.currentUser.id, tokenHash: currentHash }, data: { authVersion: req.currentUser.authVersion + 1 } })
        await tx.emailChallenge.deleteMany({ where: { userId: req.currentUser.id } })
      })
    } catch (error) { if (error instanceof InvalidChallenge) return reply.code(409).send({ error: 'A senha foi alterada em outra sessão. Entre novamente.' }); throw error }
    return { ok: true }
  })
  app.post('/auth/logout', { preHandler: [trustedOrigin, authenticated] }, async (req: any, reply) => {
    await db.session.deleteMany({ where: { tokenHash: digest(req.cookies[cookieName]) } })
    reply.clearCookie(cookieName, { path: '/' }); return { ok: true }
  })
  return authenticated
}
