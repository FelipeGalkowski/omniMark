import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'

export function registerAccounts(app: FastifyInstance, db: PrismaClient, authenticated: any, origin: string) {
  app.delete('/companies/:id/accounts/:accountId', { preHandler: authenticated }, async (req: any, reply) => {
    if (req.headers.origin !== origin) return reply.code(403).send({ error: 'Origem não permitida.' })
    const parsed = z.object({ id: z.string().uuid(), accountId: z.string().uuid() }).safeParse(req.params)
    if (!parsed.success) return reply.code(400).send({ error: 'Identificadores inválidos.' })
    const { id, accountId } = parsed.data
    const member = await db.companyMember.findUnique({ where: { userId_companyId: { userId: req.currentUser.id, companyId: id } } })
    if (!member) return reply.code(404).send({ error: 'Empresa não encontrada.' })
    if (!['OWNER', 'ADMIN'].includes(member.role)) return reply.code(403).send({ error: 'Somente administradores podem desconectar contas.' })

    // The predicate is checked atomically against the same row used to acquire the sync lock.
    // Database cascades remove local credentials, orders and their items together.
    const removed = await db.marketplaceAccount.deleteMany({ where: {
      id: accountId, companyId: id,
      OR: [{ syncLockUntil: null }, { syncLockUntil: { lte: new Date() } }],
    } })
    if (!removed.count) {
      const account = await db.marketplaceAccount.findFirst({ where: { id: accountId, companyId: id }, select: { id: true } })
      if (account) return reply.code(409).send({ error: 'Aguarde a sincronização terminar antes de desconectar esta conta.' })
      return reply.code(404).send({ error: 'Conta não encontrada.' })
    }
    return { ok: true }
  })
}
