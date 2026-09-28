import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'

export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export function vault(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('TOKEN_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.')
  const bytes = Buffer.from(key, 'hex')
  return {
    seal(value: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', bytes, iv)
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
    },
    open(value: string) {
      const data = Buffer.from(value, 'base64')
      const cipher = createDecipheriv('aes-256-gcm', bytes, data.subarray(0, 12))
      cipher.setAuthTag(data.subarray(12, 28))
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
}
export function configuration() {
  const clientId = process.env.ML_CLIENT_ID ?? ''
  const secret = process.env.SECRET_KEY_ML ?? ''
  const redirect = process.env.ML_REDIRECT_URI ?? ''
  const url = new URL(redirect)
  if (!/^\d+$/.test(clientId) || !secret || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/integrations/mercadolivre/callback') throw new Error('Configuração incompleta')
  return { clientId, secret, redirect, crypt: vault(process.env.TOKEN_ENCRYPTION_KEY ?? '') }
}

export function registerMercadoLivre(app: FastifyInstance, db: PrismaClient, authenticated: any, cookieName: string, origin: string, request: typeof fetch = fetch) {
  // Authorization start and completion require the configured frontend origin.
  const guard = async (req: any, reply: any) => {
    if (req.headers.origin !== origin) return reply.code(403).send({ error: 'Origem não permitida.' })
    return authenticated(req, reply)
  }
  app.post('/companies/:id/integrations/mercadolivre/authorize', { preHandler: guard }, async (req: any, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
    if (!member) return reply.code(404).send({ error: 'Empresa não encontrada.' })
    if (member.role === 'VIEWER') return reply.code(403).send({ error: 'Somente administradores podem conectar contas.' })
    let config: ReturnType<typeof configuration>
    try { config = configuration() } catch { return reply.code(503).send({ error: 'Configure o endereço HTTPS de retorno do Mercado Livre no servidor antes de conectar.' }) }
    const state = randomBytes(32).toString('hex')
    const verifier = randomBytes(32).toString('base64url')
    await db.oAuthAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await db.oAuthAttempt.create({ data: { stateHash: digest(state), sessionHash: digest(req.cookies[cookieName]), userId: req.currentUser.id, companyId: id, verifierCipher: config.crypt.seal(verifier), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const url = new URL('https://auth.mercadolivre.com.br/authorization')
    url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirect, state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString()
    reply.header('Cache-Control', 'no-store')
    return { url: url.href }
  })

  app.get('/integrations/mercadolivre/callback', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    const parsed = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(2048).optional(), error: z.string().max(200).optional() }).safeParse(req.query)
    if (!parsed.success || (!parsed.data.code && !parsed.data.error)) return reply.code(400).send({ error: 'Retorno inválido. Inicie a conexão novamente no OmniMark.' })
    let config: ReturnType<typeof configuration>
    try { config = configuration() } catch { return reply.code(503).send({ error: 'Integração não configurada.' }) }
    const { state, code, error } = parsed.data
    const updated = await db.oAuthAttempt.updateMany({ where: { stateHash: digest(state), expiresAt: { gt: new Date() }, codeCipher: null, denied: false }, data: error ? { denied: true } : { codeCipher: config.crypt.seal(code!) } })
    if (updated.count !== 1) return reply.code(400).send({ error: 'Autorização expirada ou já utilizada. Inicie novamente no OmniMark.' })
    // The browser receives only state; completion requires the original session.
    return reply.redirect(`${origin}/#ml_state=${state}`)
  })

  app.post('/integrations/mercadolivre/complete', { preHandler: guard }, async (req: any, reply) => {
    reply.header('Cache-Control', 'no-store')
    const { state } = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body)
    const attempt = await db.oAuthAttempt.findUnique({ where: { stateHash: digest(state) } })
    if (!attempt || attempt.expiresAt < new Date() || attempt.userId !== req.currentUser.id || attempt.sessionHash !== digest(req.cookies[cookieName]) || (!attempt.codeCipher && !attempt.denied)) return reply.code(400).send({ error: 'Conexão expirada ou iniciada em outra sessão. Tente novamente.' })
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: attempt.userId, companyId: attempt.companyId } } })
    if (!member || member.role === 'VIEWER') return reply.code(403).send({ error: 'Sem permissão para conectar nesta empresa.' })
    // Consume state atomically so only one completion can exchange the code.
    const claimed = await db.oAuthAttempt.deleteMany({ where: { stateHash: attempt.stateHash } })
    if (!claimed.count) return reply.code(400).send({ error: 'Autorização já utilizada.' })
    if (attempt.denied) return reply.code(400).send({ error: 'Autorização cancelada no Mercado Livre.' })
    try {
      const config = configuration()
      const response = await request('https://api.mercadolibre.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.secret, redirect_uri: config.redirect, code: config.crypt.open(attempt.codeCipher!), code_verifier: config.crypt.open(attempt.verifierCipher) }), signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('Token exchange failed')
      const token = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), user_id: z.number().int().positive() }).parse(await response.json())
      const profileResponse = await request('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) })
      if (!profileResponse.ok) throw new Error('Profile failed')
      const profile = z.object({ id: z.number(), nickname: z.string().min(1) }).parse(await profileResponse.json())
      if (profile.id !== token.user_id) throw new Error('Identity mismatch')
      await db.$transaction(async tx => {
        const currentMember = await tx.companyMember.findUnique({ where: { userId_companyId: { userId: attempt.userId, companyId: attempt.companyId } } })
        if (!currentMember || currentMember.role === 'VIEWER') throw new Error('Permission changed')
        const existing = await tx.marketplaceAccount.findUnique({ where: { marketplace_externalId: { marketplace: 'MERCADO_LIVRE', externalId: String(profile.id) } } })
        if (existing && existing.companyId !== attempt.companyId) throw new Error('Account already assigned')
        const account = existing ? await tx.marketplaceAccount.update({ where: { id: existing.id }, data: { label: profile.nickname, status: 'CONNECTED' } }) : await tx.marketplaceAccount.create({ data: { companyId: attempt.companyId, marketplace: 'MERCADO_LIVRE', externalId: String(profile.id), label: profile.nickname, status: 'CONNECTED' } })
        const data = { tokenCipher: config.crypt.seal(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token })), expiresAt: new Date(Date.now() + token.expires_in * 1000) }
        await tx.marketplaceCredential.upsert({ where: { accountId: account.id }, create: { accountId: account.id, ...data }, update: data })
      })
      return { companyId: attempt.companyId, connected: true }
    } catch {
      // Never log provider responses, authorization codes, or token payloads.
      return reply.code(502).send({ error: 'Não foi possível concluir a conexão. Confira a configuração da aplicação e se a conta já está vinculada a outra empresa; depois tente novamente.' })
    }
  })
}
