import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { digest } from './mercadolivre.js'
import { shopeeEnvironment, shopeeConfiguration, shopeeAuthorizationUrl, exchangeShopeeCode, refreshShopeeTokens } from './shopee-client.js'

const stateInput = z.string().regex(/^[a-f0-9]{64}$/)
const shopIdInput = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)))
export function registerShopee(app: FastifyInstance, db: PrismaClient, authenticated: any, cookieName: string, origin: string, request: typeof fetch = fetch) {
  app.get('/integrations/shopee/environment', { preHandler: authenticated }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { environment: shopeeEnvironment().environment }
  })
  const guard = async (req: any, reply: any) => {
    if (req.headers.origin !== origin) return reply.code(403).send({ error: 'Origem não permitida.' })
    return authenticated(req, reply)
  }
  app.post('/companies/:id/integrations/shopee/authorize', { preHandler: guard }, async (req: any, reply) => {
    reply.header('Cache-Control', 'no-store')
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'Empresa inválida.' })
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: params.data.id } } })
    if (!member) return reply.code(404).send({ error: 'Empresa não encontrada.' })
    if (!['OWNER', 'ADMIN'].includes(member.role)) return reply.code(403).send({ error: 'Somente administradores podem conectar contas.' })
    let config: ReturnType<typeof shopeeConfiguration>
    try { config = shopeeConfiguration(origin) } catch { return reply.code(503).send({ error: 'A conexão Shopee aguarda as credenciais e o retorno HTTPS no servidor.' }) }
    const state = randomBytes(32).toString('hex')
    await db.shopeeOAuthAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await db.shopeeOAuthAttempt.create({ data: { stateHash: digest(state), sessionHash: digest(req.cookies[cookieName]),
      userId: req.currentUser.id, companyId: params.data.id, environment: config.environment, partnerId: config.partnerId,
      expiresAt: new Date(Date.now() + 10 * 60000) } })
    return { url: shopeeAuthorizationUrl(config, state) }
  })
  app.get('/integrations/shopee/callback', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    const input = z.object({ state: stateInput, code: z.string().min(1).max(8192).optional(), shop_id: shopIdInput.optional(),
      main_account_id: z.string().optional(), error: z.string().min(1).max(200).optional() }).safeParse(req.query)
    if (!input.success || (!!input.data.code === !!input.data.error) || (input.data.code && (!input.data.shop_id || input.data.main_account_id))) {
      return reply.code(400).send({ error: 'Retorno inválido. Inicie a conexão pelo OmniMark e autorize diretamente uma loja Shopee por vez.' })
    }
    let config: ReturnType<typeof shopeeConfiguration>
    try { config = shopeeConfiguration(origin) } catch { return reply.code(503).send({ error: 'Integração Shopee ainda não configurada.' }) }
    const { state, code, shop_id, error } = input.data
    const result = await db.shopeeOAuthAttempt.updateMany({ where: { stateHash: digest(state), expiresAt: { gt: new Date() },
      codeCipher: null, denied: false, environment: config.environment, partnerId: config.partnerId },
      data: error ? { denied: true } : { codeCipher: config.crypt.seal(JSON.stringify({ code, shopId: shop_id })) } })
    if (result.count !== 1) return reply.code(400).send({ error: 'Autorização expirada ou já utilizada. Inicie novamente no OmniMark.' })
    return reply.redirect(`${origin}/#shopee_state=${state}`)
  })
  app.post('/integrations/shopee/complete', { preHandler: guard }, async (req: any, reply) => {
    reply.header('Cache-Control', 'no-store')
    const input = z.object({ state: stateInput }).safeParse(req.body)
    if (!input.success) return reply.code(400).send({ error: 'Autorização inválida.' })
    const attempt = await db.shopeeOAuthAttempt.findUnique({ where: { stateHash: digest(input.data.state) } })
    if (!attempt || attempt.expiresAt <= new Date() || attempt.userId !== req.currentUser.id ||
        attempt.sessionHash !== digest(req.cookies[cookieName]) || (!attempt.codeCipher && !attempt.denied)) return reply.code(400).send({ error: 'Conexão expirada ou iniciada em outra sessão. Tente novamente.' })
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: attempt.userId, companyId: attempt.companyId } } })
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) return reply.code(403).send({ error: 'Sem permissão para conectar nesta empresa.' })
    let config: ReturnType<typeof shopeeConfiguration>
    try { config = shopeeConfiguration(origin) } catch { return reply.code(503).send({ error: 'Integração Shopee ainda não configurada.' }) }
    if (attempt.environment !== config.environment || attempt.partnerId !== config.partnerId) return reply.code(400).send({ error: 'A configuração Shopee mudou. Inicie uma nova conexão.' })
    const claimed = await db.shopeeOAuthAttempt.deleteMany({ where: { stateHash: attempt.stateHash } })
    if (claimed.count !== 1) return reply.code(400).send({ error: 'Autorização já utilizada.' })
    if (attempt.denied) return reply.code(400).send({ error: 'Autorização cancelada na Shopee.' })
    try {
      const { code, shopId } = z.object({ code: z.string().min(1), shopId: shopIdInput }).parse(JSON.parse(config.crypt.open(attempt.codeCipher!)))
      const initial = await exchangeShopeeCode(config, code, shopId, request)
      // Initial shop-level token responses can omit identity. The documented
      // refresh response confirms shop_id and partner_id before any persistence.
      const token = await refreshShopeeTokens(config, initial.tokens, request)
      await db.$transaction(async tx => {
        const current = await tx.companyMember.findUnique({ where: { userId_companyId: { userId: attempt.userId, companyId: attempt.companyId } } })
        if (!current || !['OWNER', 'ADMIN'].includes(current.role)) throw new Error('Permissão alterada')
        const existing = await tx.marketplaceAccount.findUnique({ where: { marketplace_externalId_environment: { marketplace: 'SHOPEE', externalId: shopId, environment: config.environment } } })
        if (existing && existing.companyId !== attempt.companyId) throw new Error('Loja vinculada a outra empresa')
        let accountId: string
        if (existing) {
          const changed = await tx.marketplaceAccount.updateMany({ where: { id: existing.id, companyId: attempt.companyId,
            OR: [{ syncLockUntil: null }, { syncLockUntil: { lte: new Date() } }] },
            data: { status: 'CONNECTED', syncFailures: 0, syncError: null, nextSyncAt: new Date() } })
          if (changed.count !== 1) throw new Error('Sincronização em andamento')
          accountId = existing.id
        } else {
          const account = await tx.marketplaceAccount.create({ data: { companyId: attempt.companyId, marketplace: 'SHOPEE', externalId: shopId,
            environment: config.environment, label: `Shopee${config.environment === 'SANDBOX' ? ' Sandbox' : ''} · ${shopId}`, status: 'CONNECTED' } })
          accountId = account.id
        }
        const data = { tokenCipher: config.crypt.seal(JSON.stringify(token.tokens)), expiresAt: token.expiresAt }
        await tx.marketplaceCredential.upsert({ where: { accountId }, create: { accountId, ...data }, update: data })
      })
      return { connected: true, companyId: attempt.companyId, environment: config.environment }
    } catch {
      return reply.code(502).send({ error: 'Não foi possível concluir a conexão Shopee. Confira as credenciais, as permissões e se a loja já está vinculada a outra empresa; depois inicie novamente.' })
    }
  })
}
