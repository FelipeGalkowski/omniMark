import { randomUUID } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import argon2 from 'argon2'
import { z } from 'zod'
import { registerAuthentication } from './authentication.js'
import { digest, emailConfiguration, processEmailQueue } from './account-email.js'

const origin = 'https://stage.example.test'
const email = 'owner@example.test'
const password = 'original-password-123'
const newPassword = 'changed-password-456'
let app: ReturnType<typeof Fastify>
let db: any
let tables: Record<string, any[]>

// Test store emulates Prisma predicates, atomic conditional writes and rollback.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, expected]: [string, any]) => {
    if (key === 'OR') return expected.some((condition: any) => matches(row, condition))
    if (key === 'userId_purpose') return matches(row, expected)
    if (expected instanceof Date) return row[key]?.getTime() === expected.getTime()
    if (expected !== null && typeof expected === 'object') return Object.entries(expected).every(([op, value]: [string, any]) => {
      if (op === 'not') return row[key] !== value
      if (op === 'lt') return row[key] < value
      if (op === 'lte') return row[key] <= value
      if (op === 'gt') return row[key] > value
      return false
    })
    return row[key] === expected
  })
}
function change(row: any, data: any) {
  for (const [key, value] of Object.entries(data) as [string, any][]) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value
  return structuredClone(row)
}
beforeEach(async () => {
  vi.stubEnv('RESEND_API_KEY', 're_test-only'); vi.stubEnv('RESEND_FROM', 'OmniMark <access@example.test>')
  vi.stubEnv('WEB_ORIGIN', origin); vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32))
  tables = { user: [], session: [], emailChallenge: [], emailDelivery: [], emailThrottle: [] }
  db = {}
  for (const name of Object.keys(tables)) db[name] = {
    findUnique: vi.fn(async ({ where, include }: any) => {
      const row = tables[name].find(row => matches(row, where))
      if (!row) return null
      return structuredClone({ ...row, ...(include?.user ? { user: tables.user.find(user => user.id === row.userId) } : {}) })
    }),
    findMany: vi.fn(async ({ where, take }: any) => structuredClone(tables[name].filter(row => matches(row, where)).slice(0, take ?? Infinity))),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: randomUUID(), attempts: 0, authVersion: 0, emailVerifiedAt: null, createdAt: new Date(), nextAttemptAt: new Date(), lockUntil: null, lockId: null, sentAt: null, challengeId: null, ...data }
      tables[name].push(row); return structuredClone(row)
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = tables[name].find(row => matches(row, where)); if (!row) throw new Error('Missing record')
      return change(row, data)
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = tables[name].filter(row => matches(row, where)); rows.forEach(row => change(row, data)); return { count: rows.length }
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const removed = tables[name].filter(row => matches(row, where)); tables[name] = tables[name].filter(row => !matches(row, where))
      if (name === 'emailChallenge') tables.emailDelivery = tables.emailDelivery.filter(row => !removed.some(challenge => challenge.id === row.challengeId))
      return { count: removed.length }
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const row = tables[name].find(row => matches(row, where))
      if (row) return change(row, update)
      tables[name].push(structuredClone(create)); return structuredClone(create)
    }),
  }
  db.$transaction = async (fn: any) => {
    const snapshot = structuredClone(tables)
    try { return await fn(db) } catch (error) { tables = snapshot; throw error }
  }
  app = Fastify(); await app.register(cookie); await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  app.setErrorHandler((error: Error, _req: FastifyRequest, reply: FastifyReply) => { reply.code(error instanceof z.ZodError ? 400 : (error as any).statusCode ?? 500).send({ error: 'Dados inválidos' }) })
  const authenticated = registerAuthentication(app, db, { origin, cookieName: 'session', secure: true })
  app.get('/protected', { preHandler: authenticated }, () => ({ ok: true }))
})
afterEach(async () => { await app.close(); vi.unstubAllEnvs() })
const post = (url: string, payload: any, headers = {}) => app.inject({ method: 'POST', url, headers: { origin, ...headers }, payload })
const register = () => post('/auth/register', { name: 'Owner', email, password })
const requestReset = (address = email) => post('/auth/password/request', { email: address })
const pendingMessage = () => JSON.parse(emailConfiguration().crypt.open(tables.emailDelivery.find(row => row.payloadCipher).payloadCipher))
const code = () => pendingMessage().text.match(/\b\d{6}\b/)[0]
const resetToken = () => pendingMessage().text.match(/reset_token=([a-f0-9]{64})/)[1]
const unthrottle = () => tables.emailThrottle.forEach(row => { row.nextAllowedAt = new Date(0) })
const userRecord = async (verified = true) => db.user.create({ data: { email, name: 'Owner', passwordHash: await argon2.hash(password), emailVerifiedAt: verified ? new Date() : null } })
const login = () => post('/auth/login', { email, password })

it('queues encrypted confirmation and prevents access before verification', async () => {
  const response = await register()
  expect(response.statusCode).toBe(201)
  expect(response.json()).toMatchObject({ verificationRequired: true, email })
  expect(response.headers['set-cookie']).toBeUndefined()
  expect(tables.session).toHaveLength(0)
  expect(await argon2.verify(tables.user[0].passwordHash, password)).toBe(true)
  expect(tables.emailDelivery[0].payloadCipher).not.toContain(email)
  expect(tables.emailChallenge[0].tokenHash).not.toBe(digest(code()))
  expect((await login()).json().verificationRequired).toBe(true)
  expect(tables.emailDelivery).toHaveLength(1)
  const proof = code()
  expect((await post('/auth/email/verify', { email, code: proof })).statusCode).toBe(200)
  expect(tables.user[0].emailVerifiedAt).toBeInstanceOf(Date)
  expect((await post('/auth/email/verify', { email, code: proof })).statusCode).toBe(400)
  const signedIn = await login()
  expect(signedIn.json().user.emailVerified).toBe(true)
  expect(String(signedIn.headers['set-cookie'])).toMatch(/HttpOnly/)
  expect(String(signedIn.headers['set-cookie'])).toMatch(/Secure/)
  expect(tables.session).toHaveLength(1)
})
it('allows pending signup retry without overwriting its password or name', async () => {
  await register()
  expect((await register()).json().verificationRequired).toBe(true)
  expect(tables.user).toHaveLength(1); expect(tables.emailDelivery).toHaveLength(1)
  expect((await post('/auth/register', { name: 'Attacker', email, password: newPassword })).statusCode).toBe(409)
  expect(tables.user[0].name).toBe('Owner')
  expect(await argon2.verify(tables.user[0].passwordHash, password)).toBe(true)
})
it('limits code guesses, invalidates old codes on resend and enforces expiry', async () => {
  await register()
  const previous = code()
  const wrong = previous === '111111' ? '222222' : '111111'
  for (let attempt = 0; attempt < 5; attempt++) expect((await post('/auth/email/verify', { email, code: wrong })).statusCode).toBe(400)
  expect((await post('/auth/email/verify', { email, code: previous })).statusCode).toBe(400)
  expect(tables.emailChallenge[0].attempts).toBe(5)
  unthrottle(); await post('/auth/email/request', { email })
  expect(tables.emailChallenge).toHaveLength(1); expect(tables.emailChallenge[0].attempts).toBe(0)
  tables.emailChallenge[0].expiresAt = new Date(0)
  expect((await post('/auth/email/verify', { email, code: code() })).statusCode).toBe(400)
  expect(tables.user[0].emailVerifiedAt).toBeNull()
})
it('gives the same recovery response for existing, unknown and throttled addresses', async () => {
  await userRecord()
  const before = tables.user[0].passwordHash
  const known = await requestReset()
  const unknown = await requestReset('unknown@example.test')
  const throttled = await requestReset()
  expect(known.statusCode).toBe(200)
  expect(known.json()).toEqual(unknown.json()); expect(throttled.json()).toEqual(known.json())
  expect(tables.emailDelivery).toHaveLength(1)
  expect(tables.user[0].passwordHash).toBe(before)
  expect(known.body).not.toContain(resetToken())
})
it('resets with a one-use link, confirms the mailbox and invalidates all prior sessions', async () => {
  const user = await userRecord()
  const signedIn = await login()
  const oldCookie = String(signedIn.headers['set-cookie']).split(';')[0]
  const staleSession = structuredClone(tables.session[0])
  await requestReset()
  const token = resetToken()
  const response = await post('/auth/password/reset', { token, password: newPassword })
  expect(response.statusCode).toBe(200)
  expect(tables.user[0].authVersion).toBe(user.authVersion + 1)
  expect(tables.user[0].emailVerifiedAt).toBeInstanceOf(Date)
  expect(tables.session).toHaveLength(0)
  expect(tables.emailChallenge).toHaveLength(0)
  expect(await argon2.verify(tables.user[0].passwordHash, newPassword)).toBe(true)
  expect((await post('/auth/password/reset', { token, password })).statusCode).toBe(400)
  tables.session.push(staleSession) // Login that verified the old password before reset completed.
  expect((await app.inject({ url: '/protected', headers: { cookie: oldCookie } })).statusCode).toBe(401)
  expect((await login()).statusCode).toBe(401)
  expect((await post('/auth/login', { email, password: newPassword })).statusCode).toBe(200)
})
it('rejects expired links and challenge hashes without changing a password', async () => {
  await userRecord(false); await requestReset()
  const token = resetToken(); const initial = tables.user[0].passwordHash
  expect((await post('/auth/password/reset', { token: tables.emailChallenge[0].tokenHash, password: newPassword })).statusCode).toBe(400)
  tables.emailChallenge[0].expiresAt = new Date(0)
  expect((await post('/auth/password/reset', { token, password: newPassword })).statusCode).toBe(400)
  expect(tables.user[0].passwordHash).toBe(initial)
})
it('rolls back when another request consumes the reset link first', async () => {
  await userRecord(); await requestReset()
  const token = resetToken(); const initial = tables.user[0].passwordHash
  db.emailChallenge.deleteMany.mockResolvedValueOnce({ count: 0 })
  expect((await post('/auth/password/reset', { token, password: newPassword })).statusCode).toBe(400)
  expect(tables.user[0].passwordHash).toBe(initial)
})
it('preserves pre-existing sessions while requiring confirmation on the next login', async () => {
  const user = await userRecord(false)
  await db.session.create({ data: { userId: user.id, tokenHash: digest('legacy'), authVersion: 0, expiresAt: new Date(Date.now() + 100000) } })
  expect((await app.inject({ url: '/protected', headers: { cookie: 'session=legacy' } })).statusCode).toBe(200)
  const response = await login()
  expect(response.json().verificationRequired).toBe(true)
  expect(response.headers['set-cookie']).toBeUndefined()
})
it('changes a known password, invalidates reset links and keeps only the current session', async () => {
  await userRecord()
  const first = await login(); const current = await login(); await requestReset()
  const token = resetToken()
  const response = await app.inject({ method: 'PATCH', url: '/auth/password', headers: { origin, cookie: String(current.headers['set-cookie']).split(';')[0] }, payload: { currentPassword: password, password: newPassword } })
  expect(response.statusCode).toBe(200); expect(tables.session).toHaveLength(1)
  expect((await app.inject({ url: '/protected', headers: { cookie: String(current.headers['set-cookie']).split(';')[0] } })).statusCode).toBe(200)
  expect((await app.inject({ url: '/protected', headers: { cookie: String(first.headers['set-cookie']).split(';')[0] } })).statusCode).toBe(401)
  expect((await post('/auth/password/reset', { token, password })).statusCode).toBe(400)
})
it('rejects untrusted origins and refuses new registration without mail configuration', async () => {
  expect((await post('/auth/register', { name: 'Owner', email, password }, { origin: 'https://attacker.test' })).statusCode).toBe(403)
  vi.stubEnv('RESEND_API_KEY', '')
  expect((await register()).statusCode).toBe(503)
  expect((await requestReset()).statusCode).toBe(503)
  expect(tables.user).toHaveLength(0)
})
it('sends queued mail once across competing workers and erases plaintext-equivalent payloads', async () => {
  await register()
  const send = vi.fn(async (_url: any, _init: any) => new Response('{"id":"mail-id"}', { status: 200 }))
  const log = vi.fn()
  await Promise.all([processEmailQueue(db, send, log), processEmailQueue(db, send, log)])
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0]).toBe('https://api.resend.com/emails')
  expect((send.mock.calls[0] as any)[1].headers['Idempotency-Key']).toMatch(/^account-email\//)
  expect(tables.emailDelivery[0].payloadCipher).toBeNull()
  expect(tables.emailDelivery[0].sentAt).toBeInstanceOf(Date)
  expect(log).not.toHaveBeenCalled()
})
it('retries a failed delivery with the same idempotency key and redacts failure logs', async () => {
  await register()
  const send = vi.fn(async (_url: any, _init: any) => new Response('sensitive-provider-body', { status: 503 }))
  const log = vi.fn()
  for (let i = 0; i < 3; i++) {
    tables.emailDelivery[0].nextAttemptAt = new Date(0)
    await processEmailQueue(db, send, log)
  }
  expect(send).toHaveBeenCalledTimes(3)
  expect(new Set(send.mock.calls.map((call: any) => call[1].headers['Idempotency-Key'])).size).toBe(1)
  expect(log.mock.calls).toEqual([[503], [503], [503]])
  expect(tables.emailDelivery[0].payloadCipher).toBeNull()
})
it('does not send an expired code', async () => {
  await register(); tables.emailChallenge[0].expiresAt = new Date(0)
  const send = vi.fn()
  await processEmailQueue(db, send)
  expect(send).not.toHaveBeenCalled()
  expect(tables.emailDelivery[0].payloadCipher).toBeNull()
})
it('enforces retry backoff and the final attempt across concurrent workers', async () => {
  await register(); tables.emailDelivery[0].attempts = 2
  const send = vi.fn(async () => new Response('temporary failure', { status: 503 }))
  await Promise.all([processEmailQueue(db, send), processEmailQueue(db, send)])
  expect(send).toHaveBeenCalledTimes(1)
  expect(tables.emailDelivery[0].attempts).toBe(3)
  expect(tables.emailDelivery[0].payloadCipher).toBeNull()
  await processEmailQueue(db, send)
  expect(send).toHaveBeenCalledTimes(1)
})
