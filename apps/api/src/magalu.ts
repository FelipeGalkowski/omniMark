import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { digest, vault } from './mercadolivre.js'

export const MAGALU_SCOPES = ['open:order-order-seller:read', 'open:order-delivery-seller:read']
const stateInput = z.string().regex(/^[a-f0-9]{64}$/)
const tokenSchema = z.object({
  access_token: z.string().min(1).max(32768), refresh_token: z.string().min(1).max(32768),
  token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
  expires_in: z.number().int().positive().max(86400), scope: z.string(),
})

export function magaluConfiguration(origin: string) {
  const clientId = z.string().trim().min(1).max(256).parse(process.env.MAGALU_CLIENT_ID)
  const secret = z.string().min(1).parse(process.env.MAGALU_CLIENT_SECRET)
  const redirect = new URL(process.env.MAGALU_REDIRECT_URI ?? '')
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash ||
      redirect.pathname !== '/integrations/magalu/callback' || redirect.origin !== new URL(origin).origin) throw new Error('Configuração inválida')
  return { clientId, secret, redirect: redirect.href, crypt: vault(process.env.TOKEN_ENCRYPTION_KEY ?? '') }
}

// Only call with a token obtained directly from the fixed ID Magalu token endpoint.
// This decodes provider metadata, never browser-supplied JWTs or application sessions.
export function magaluTenant(accessToken: string) {
  const parts = accessToken.split('.')
  if (parts.length !== 3) throw new Error('Token sem identificação de loja')
  const claims = z.object({ sub: z.string(), exp: z.number().int().positive() }).parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')))
  if (claims.exp * 1000 <= Date.now()) throw new Error('Token expirado')
  // ID Magalu represents tenants as GENPUB.uuid; canonicalize to prevent aliases.
  return z.string().uuid().parse(claims.sub.replace(/^GENPUB\./, '')).toLowerCase()
}

export function registerMagalu(app: FastifyInstance, db: PrismaClient, authenticated: any, cookieName: string, origin: string, request: typeof fetch = fetch) {
  const guard = async (req: any, reply: any) => {
    if (req.headers.origin !== origin) return reply.code(403).send({ error: 'Origem não permitida.' })
    return authenticated(req, reply)
  }
  app.post('/companies/:id/integrations/magalu/authorize', { preHandler: guard }, async (req: any, reply) => {
    reply.header('Cache-Control', 'no-store')
    const input = z.object({ id: z.string().uuid() }).safeParse(req.params)
    if (!input.success) return reply.code(400).send({ error: 'Empresa inválida.' })
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: input.data.id } } })
    if (!member) return reply.code(404).send({ error: 'Empresa não encontrada.' })
    if (!['OWNER', 'ADMIN'].includes(member.role)) return reply.code(403).send({ error: 'Somente administradores podem conectar contas.' })
    let config: ReturnType<typeof magaluConfiguration>
    try { config = magaluConfiguration(origin) } catch { return reply.code(503).send({ error: 'A conexão com o Magalu aguarda a configuração das credenciais e do retorno HTTPS no servidor.' }) }
    const state = randomBytes(32).toString('hex')
    await db.magaluOAuthAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await db.magaluOAuthAttempt.create({ data: {
      stateHash: digest(state), sessionHash: digest(req.cookies[cookieName]), userId: req.currentUser.id,
      companyId: input.data.id, expiresAt: new Date(Date.now() + 10 * 60_000),
    } })
    const url = new URL('https://id.magalu.com/login')
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect, response_type: 'code',
      choose_tenants: 'true', scope: MAGALU_SCOPES.join(' '), state }).toString()
    return { url: url.href }
  })

  app.get('/integrations/magalu/callback', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    const parsed = z.object({ state: stateInput, code: z.string().min(1).max(8192).optional(), error: z.string().min(1).max(200).optional() }).safeParse(req.query)
    if (!parsed.success || (!!parsed.data.code === !!parsed.data.error)) return reply.code(400).send({ error: 'Retorno inválido. Inicie a conexão com o Magalu pelo OmniMark.' })
    let config: ReturnType<typeof magaluConfiguration>
    try { config = magaluConfiguration(origin) } catch { return reply.code(503).send({ error: 'Integração Magalu ainda não configurada no servidor.' }) }
    const { state, code, error } = parsed.data
    const result = await db.magaluOAuthAttempt.updateMany({
      where: { stateHash: digest(state), expiresAt: { gt: new Date() }, codeCipher: null, denied: false },
      data: error ? { denied: true } : { codeCipher: config.crypt.seal(code!) },
    })
    if (result.count !== 1) return reply.code(400).send({ error: 'Autorização expirada ou já utilizada. Inicie novamente no OmniMark.' })
    return reply.redirect(`${origin}/#magalu_state=${state}`)
  })

  app.post('/integrations/magalu/complete', { preHandler: guard }, async (req: any, reply) => {
    reply.header('Cache-Control', 'no-store')
    const input = z.object({ state: stateInput }).safeParse(req.body)
    if (!input.success) return reply.code(400).send({ error: 'Autorização inválida.' })
    const attempt = await db.magaluOAuthAttempt.findUnique({ where: { stateHash: digest(input.data.state) } })
    if (!attempt || attempt.expiresAt <= new Date() || attempt.userId !== req.currentUser.id ||
        attempt.sessionHash !== digest(req.cookies[cookieName]) || (!attempt.codeCipher && !attempt.denied)) return reply.code(400).send({ error: 'Conexão expirada ou iniciada em outra sessão. Tente novamente.' })
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: attempt.userId, companyId: attempt.companyId } } })
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) return reply.code(403).send({ error: 'Sem permissão para conectar nesta empresa.' })
    const claimed = await db.magaluOAuthAttempt.deleteMany({ where: { stateHash: attempt.stateHash } })
    if (!claimed.count) return reply.code(400).send({ error: 'Autorização já utilizada.' })
    if (attempt.denied) return reply.code(400).send({ error: 'Autorização cancelada no Magalu.' })
    try {
      const config = magaluConfiguration(origin)
      const response = await request('https://id.magalu.com/oauth/token', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.secret,
          redirect_uri: config.redirect, code: config.crypt.open(attempt.codeCipher!) }), signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error('Falha na autorização')
      const token = tokenSchema.parse(await response.json())
      if (!MAGALU_SCOPES.every(scope => token.scope.split(/\s+/).includes(scope))) throw new Error('Permissões insuficientes')
      const tenant = magaluTenant(token.access_token)
      await db.$transaction(async tx => {
        const current = await tx.companyMember.findUnique({ where: { userId_companyId: { userId: attempt.userId, companyId: attempt.companyId } } })
        if (!current || !['OWNER', 'ADMIN'].includes(current.role)) throw new Error('Permissão alterada')
        const existing = await tx.marketplaceAccount.findUnique({ where: { marketplace_externalId: { marketplace: 'MAGALU', externalId: tenant } } })
        if (existing && existing.companyId !== attempt.companyId) throw new Error('Loja vinculada a outra empresa')
        if (existing?.syncLockUntil && existing.syncLockUntil > new Date()) throw new Error('Sincronização em andamento')
        const account = existing
          ? await tx.marketplaceAccount.update({ where: { id: existing.id }, data: { status: 'CONNECTED' } })
          : await tx.marketplaceAccount.create({ data: { companyId: attempt.companyId, marketplace: 'MAGALU', externalId: tenant, label: `Magalu · ${tenant.slice(0, 8)}`, status: 'CONNECTED' } })
        const data = { tokenCipher: config.crypt.seal(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token })), expiresAt: new Date(Date.now() + token.expires_in * 1000) }
        await tx.marketplaceCredential.upsert({ where: { accountId: account.id }, create: { accountId: account.id, ...data }, update: data })
      })
      return { companyId: attempt.companyId, connected: true }
    } catch {
      // Do not log authorization codes, JWT claims, tokens or provider error bodies.
      return reply.code(502).send({ error: 'Não foi possível concluir a conexão com o Magalu. Confira as credenciais, as permissões de pedidos e entregas e se a loja já está vinculada a outra empresa; depois inicie novamente.' })
    }
  })
}
