import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { MarketplaceAccount, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { SyncError } from './order-sync.js'
import type { SyncAdapter } from './sync-contract.js'

export function orderSyncConfiguration() {
  return {
    enabled: z.enum(['true', 'false']).default('true').parse(process.env.ORDER_SYNC_ENABLED) === 'true',
    intervalMs: z.coerce.number().int().min(2).max(60).default(5).parse(process.env.ORDER_SYNC_INTERVAL_MINUTES) * 60_000,
    concurrency: z.coerce.number().int().min(1).max(4).default(2).parse(process.env.ORDER_SYNC_CONCURRENCY),
  }
}
type Configuration = ReturnType<typeof orderSyncConfiguration>
type AccountState = Pick<MarketplaceAccount, 'marketplace' | 'status' | 'nextSyncAt' | 'syncAttemptAt' | 'syncLockUntil' | 'syncError' | 'lastSyncAt'>
const leaseAvailable = (now: Date) => ({ OR: [{ syncLockUntil: null }, { syncLockUntil: { lt: now } }] })
const isDue = (now: Date) => ({ OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] })

export function createSyncService(db: PrismaClient, adapters: SyncAdapter[], config: Configuration = orderSyncConfiguration(), request: typeof fetch = fetch,
  warn: (details: object) => void = () => {}) {
  const registry = new Map(adapters.map(adapter => [adapter.marketplace, adapter]))
  if (registry.size !== adapters.length) throw new Error('Conector de sincronização duplicado')
  let batch: Promise<void> | undefined
  const stop = new AbortController()
  const providerRequest: typeof fetch = (input, init) => request(input, { ...init, signal: AbortSignal.any([stop.signal, ...(init?.signal ? [init.signal] : [])]) })

  const describe = (account: AccountState) => {
    const supported = registry.has(account.marketplace)
    const running = !!account.syncLockUntil && account.syncLockUntil > new Date()
    const state = !supported ? 'unsupported' : !config.enabled ? 'disabled' : account.status === 'EXPIRED' ? 'reconnect_needed'
      : account.status !== 'CONNECTED' ? 'pending' : running ? 'running' : account.syncError ? 'error' : !account.lastSyncAt || !account.nextSyncAt || account.nextSyncAt <= new Date() ? 'scheduled' : 'idle'
    return { supported, enabled: config.enabled && supported, state, intervalMinutes: config.intervalMs / 60_000,
      nextAt: account.nextSyncAt, attemptedAt: account.syncAttemptAt }
  }

  async function execute(accountId: string, marketplace: MarketplaceAccount['marketplace'], failures: number) {
    if (stop.signal.aborted) return
    const now = new Date(), lease = randomUUID()
    const claimed = await db.marketplaceAccount.updateMany({ where: {
      id: accountId, marketplace, status: 'CONNECTED', AND: [leaseAvailable(now), isDue(now)],
    }, data: { syncLock: lease, syncLockUntil: new Date(now.getTime() + 15 * 60_000), syncAttemptAt: now } })
    if (!claimed.count) return
    try {
      await registry.get(marketplace)!.run(db, accountId, providerRequest, { lease })
      await db.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: lease }, data: {
        syncFailures: 0, syncError: null, nextSyncAt: new Date(Date.now() + config.intervalMs), syncLock: null, syncLockUntil: null,
      } })
    } catch (error) {
      const failure = error instanceof SyncError ? error : new SyncError(502, 'Falha temporária ao atualizar os dados. Uma nova tentativa será feita automaticamente.')
      const retryMs = Math.max(failure.retryAfterMs, Math.min(3600_000, config.intervalMs * 2 ** Math.min(failures, 6)))
      await db.marketplaceAccount.updateMany({ where: { id: accountId, syncLock: lease }, data: {
        syncFailures: { increment: 1 }, syncError: failure.message, nextSyncAt: failure.reconnect ? null : new Date(Date.now() + retryMs),
        ...(failure.reconnect ? { status: 'EXPIRED' } : {}), syncLock: null, syncLockUntil: null,
      } })
      // No tokens, recipient data, raw exception or provider response bodies.
      if (!stop.signal.aborted) warn({ marketplace, code: failure.code, ...(failure.diagnostic ? { diagnostic: failure.diagnostic } : {}) })
    }
  }

  function processDue(): Promise<void> {
    if (!config.enabled || stop.signal.aborted) return Promise.resolve()
    if (batch) return batch
    batch = (async () => {
      const now = new Date()
      const due = await db.marketplaceAccount.findMany({ where: {
        marketplace: { in: [...registry.keys()] }, status: 'CONNECTED', AND: [leaseAvailable(now), isDue(now)],
      }, orderBy: [{ nextSyncAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: config.concurrency,
        select: { id: true, marketplace: true, syncFailures: true } })
      const results = await Promise.allSettled(due.map(account => execute(account.id, account.marketplace, account.syncFailures)))
      if (results.some(result => result.status === 'rejected')) warn({ code: 'SYNC_STORAGE_FAILURE' })
    })().finally(() => { batch = undefined })
    return batch
  }

  async function enqueue(accountId: string) {
    const account = await db.marketplaceAccount.findUnique({ where: { id: accountId } })
    if (!account) throw new SyncError(404, 'Conta não encontrada.')
    if (!registry.has(account.marketplace)) throw new SyncError(501, 'A sincronização deste marketplace ainda não está disponível.')
    if (!config.enabled) throw new SyncError(503, 'A atualização automática está pausada no servidor.')
    if (account.status !== 'CONNECTED') throw new SyncError(409, 'Reconecte a conta para atualizar os dados.', true)
    const now = new Date()
    const queued = await db.marketplaceAccount.updateMany({ where: { id: accountId, status: 'CONNECTED', AND: [leaseAvailable(now), {
      OR: [{ syncAttemptAt: null }, { syncAttemptAt: { lte: new Date(now.getTime() - 60_000) } }],
    }] }, data: { nextSyncAt: now } })
    if (!queued.count) throw new SyncError(409, 'A atualização já está em andamento ou foi solicitada recentemente. Aguarde a próxima atualização automática.')
  }

  async function close() { stop.abort(); await batch }
  return { describe, processDue, enqueue, close }
}

export function registerSyncWorker(app: FastifyInstance, service: ReturnType<typeof createSyncService>) {
  const tick = () => { void service.processDue().catch(() => app.log.warn('ORDER_SYNC_WORKER_FAILED')) }
  const timer = setInterval(tick, 5000); timer.unref()
  app.addHook('onReady', async () => { tick() })
  app.addHook('preClose', async () => { clearInterval(timer); await service.close() })
}
