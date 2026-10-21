import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient, EmailPurpose } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { vault } from './mercadolivre.js'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
type EmailConfigurationVariable = 'RESEND_API_KEY' | 'RESEND_FROM' | 'WEB_ORIGIN' | 'TOKEN_ENCRYPTION_KEY'
export class EmailConfigurationError extends Error {
  constructor(readonly issues: { variable: EmailConfigurationVariable; problem: 'missing' | 'invalid' }[]) {
    super('Configuração de e-mail indisponível')
  }
}
export function emailConfiguration() {
  const issues: EmailConfigurationError['issues'] = []
  const read = <T>(variable: EmailConfigurationVariable, parse: () => T): T | undefined => {
    try { return parse() } catch {
      // Only fixed variable names and issue categories escape this boundary, never values or validation errors.
      issues.push({ variable, problem: process.env[variable]?.trim() ? 'invalid' : 'missing' })
      return undefined
    }
  }
  const apiKey = read('RESEND_API_KEY', () => z.string().trim().min(1).parse(process.env.RESEND_API_KEY))
  const from = read('RESEND_FROM', () => {
    const value = z.string().trim().min(1).max(254).parse(process.env.RESEND_FROM)
    if (/[\r\n]/.test(value) || !z.string().email().safeParse(value.match(/<([^<>]+)>$/)?.[1] ?? value).success) throw new Error('Remetente inválido')
    return value
  })
  const origin = read('WEB_ORIGIN', () => {
    const url = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Origem inválida')
    return url.origin
  })
  const crypt = read('TOKEN_ENCRYPTION_KEY', () => vault(process.env.TOKEN_ENCRYPTION_KEY ?? ''))
  if (issues.length) throw new EmailConfigurationError(issues)
  return { apiKey: apiKey!, from: from!, origin: origin!, crypt: crypt! }
}
export const verificationHash = (userId: string, challengeId: string, code: string) => createHmac('sha256', process.env.TOKEN_ENCRYPTION_KEY ?? '').update(`verify:${userId}:${challengeId}:${code}`).digest('hex')
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
export function emailDocument(title: string, message: string, action: string, text: string, unsolicited = true) {
  const footer = unsolicited ? 'Se você não solicitou esta mensagem, ignore-a.' : 'Se você não reconhece esta alteração, recupere o acesso e entre em contato com o responsável pelo projeto.'
  return { text: `${title}\n\n${text}\n\n${footer}\nOmniMark`, html:
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#F0F2F7;padding:32px 16px;font-family:Arial,sans-serif;color:#0D0F14"><div style="max-width:480px;margin:auto"><div style="font-weight:700;margin-bottom:24px"><span style="display:inline-block;background:#0D0F14;color:white;padding:10px;border-radius:7px;margin-right:8px;font-size:12px">OM</span>Omnimark</div><div style="background:white;border:1px solid #E2E6EF;border-radius:16px;padding:28px"><h1 style="font-size:22px;line-height:1.4;margin:0 0 16px">${escape(title)}</h1><p style="font-size:14px;line-height:1.8;color:#4A5568">${escape(message)}</p>${action}<p style="font-size:12px;line-height:1.8;color:#67748A;margin-top:24px">${footer} Nunca compartilhe códigos de acesso ou links de recuperação.</p></div><p style="font-size:11px;color:#67748A;text-align:center">OmniMark · Sua operação em um só lugar</p></div></body></html>` }
}

export async function claimEmailThrottle(db: PrismaClient, email: string, purpose: EmailPurpose) {
  const key = digest(`${purpose}:${email}`)
  await db.emailThrottle.upsert({ where: { key }, create: { key, nextAllowedAt: new Date(0) }, update: { key } })
  const result = await db.emailThrottle.updateMany({ where: { key, nextAllowedAt: { lte: new Date() } }, data: { nextAllowedAt: new Date(Date.now() + 60_000) } })
  return result.count === 1
}

export async function queueChallenge(tx: Prisma.TransactionClient, user: { id: string; email: string }, purpose: EmailPurpose) {
  const config = emailConfiguration()
  const id = randomUUID()
  const secret = purpose === 'VERIFY_EMAIL' ? String(randomInt(100000, 1000000)) : randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + (purpose === 'VERIFY_EMAIL' ? 10 : 30) * 60_000)
  await tx.emailChallenge.deleteMany({ where: { userId: user.id, purpose } })
  await tx.emailChallenge.create({ data: { id, userId: user.id, purpose, expiresAt,
    tokenHash: purpose === 'VERIFY_EMAIL' ? verificationHash(user.id, id, secret) : digest(secret) } })
  const url = `${config.origin}/#reset_token=${secret}`
  const subject = purpose === 'VERIFY_EMAIL' ? 'Confirme seu e-mail no OmniMark' : 'Redefina sua senha no OmniMark'
  const message = purpose === 'VERIFY_EMAIL' ? 'Digite o código abaixo no OmniMark para confirmar seu e-mail. Ele é válido por 10 minutos e pode ser usado uma única vez.' : 'Recebemos uma solicitação para redefinir sua senha. O link abaixo é válido por 30 minutos e pode ser usado uma única vez.'
  const action = purpose === 'VERIFY_EMAIL'
    ? `<p style="font:700 32px monospace;letter-spacing:8px;margin:24px 0">${secret}</p>`
    : `<p style="margin:24px 0"><a href="${escape(url)}" style="background:#0D0F14;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;display:inline-block">Redefinir senha</a></p>`
  const body = emailDocument(subject, message, action, `${message}\n\n${purpose === 'VERIFY_EMAIL' ? secret : url}`)
  await tx.emailDelivery.create({ data: { userId: user.id, challengeId: id, payloadCipher: config.crypt.seal(JSON.stringify({ from: config.from, to: [user.email], subject, ...body })) } })
}

export async function queuePasswordNotice(tx: Prisma.TransactionClient, user: { id: string; email: string }) {
  let config: ReturnType<typeof emailConfiguration>
  try { config = emailConfiguration() } catch { return }
  const subject = 'Sua senha do OmniMark foi alterada'
  const message = 'Sua senha foi redefinida e as sessões anteriores foram encerradas. Se você não reconhece esta ação, solicite outra recuperação de senha e entre em contato com o responsável pelo projeto.'
  const body = emailDocument(subject, message, '', message, false)
  await tx.emailDelivery.create({ data: { userId: user.id, payloadCipher: config.crypt.seal(JSON.stringify({ from: config.from, to: [user.email], subject, ...body })) } })
}

const payloadSchema = z.object({ from: z.string(), to: z.array(z.string().email()).length(1), subject: z.string(), text: z.string(), html: z.string() })
export async function processEmailQueue(db: PrismaClient, request: typeof fetch = fetch, log?: (status: number) => void) {
  let config: ReturnType<typeof emailConfiguration>
  try { config = emailConfiguration() } catch { return }
  const now = new Date()
  const pending = await db.emailDelivery.findMany({ where: { payloadCipher: { not: null }, sentAt: null, attempts: { lt: 3 }, nextAttemptAt: { lte: now },
    OR: [{ lockUntil: null }, { lockUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, take: 5 })
  for (const delivery of pending) {
    const lock = randomUUID()
    const acquired = await db.emailDelivery.updateMany({ where: { id: delivery.id, payloadCipher: { not: null }, sentAt: null, attempts: delivery.attempts, nextAttemptAt: { lte: new Date() }, OR: [{ lockUntil: null }, { lockUntil: { lt: new Date() } }] }, data: { lockId: lock, lockUntil: new Date(Date.now() + 60_000) } })
    if (!acquired.count) continue
    let providerStatus = 0
    try {
      if (delivery.challengeId) {
        const challenge = await db.emailChallenge.findUnique({ where: { id: delivery.challengeId } })
        if (!challenge || challenge.expiresAt <= new Date()) {
          await db.emailDelivery.updateMany({ where: { id: delivery.id, lockId: lock }, data: { payloadCipher: null, lockId: null, lockUntil: null } }); continue
        }
      }
      const payload = payloadSchema.parse(JSON.parse(config.crypt.open(delivery.payloadCipher!)))
      const response = await request('https://api.resend.com/emails', { method: 'POST', redirect: 'error', headers: {
        Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `account-email/${delivery.id}`,
      }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) })
      providerStatus = response.status
      if (!response.ok) throw new Error('Envio recusado')
      await db.emailDelivery.updateMany({ where: { id: delivery.id, lockId: lock }, data: { sentAt: new Date(), payloadCipher: null, lockId: null, lockUntil: null } })
    } catch {
      await db.emailDelivery.updateMany({ where: { id: delivery.id, lockId: lock }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 30_000), lockId: null, lockUntil: null, ...(delivery.attempts >= 2 ? { payloadCipher: null } : {}) } })
      log?.(providerStatus) // No recipient, message body, token or provider response in logs.
    }
  }
}

export function registerEmailWorker(app: FastifyInstance, db: PrismaClient) {
  let running: Promise<void> | undefined
  let cleanupAt = 0
  const tick = () => {
    if (running) return
    running = (async () => {
      if (Date.now() > cleanupAt) {
        await db.emailChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } })
        await db.emailDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86400_000) } } })
        await db.emailThrottle.deleteMany({ where: { nextAllowedAt: { lt: new Date(Date.now() - 86400_000) } } })
        cleanupAt = Date.now() + 3600_000
      }
      await processEmailQueue(db, fetch, status => app.log.warn({ providerStatus: status }, 'ACCOUNT_EMAIL_SEND_FAILED'))
    })().catch(() => { app.log.warn('ACCOUNT_EMAIL_WORKER_FAILED') }).finally(() => { running = undefined })
  }
  const timer = setInterval(tick, 5000); timer.unref()
  app.addHook('onReady', async () => { tick() })
  app.addHook('preClose', async () => { clearInterval(timer); await running })
}
