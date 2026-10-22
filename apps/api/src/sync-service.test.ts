import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { createSyncService, orderSyncConfiguration, registerSyncWorker } from './sync-service.js'
import { SyncError } from './order-sync.js'
import type { SyncAdapter } from './sync-contract.js'

const config = { enabled: true, intervalMs: 300000, concurrency: 2 }
const fixture = (overrides = {}) => ({ id: 'account', marketplace: 'MERCADO_LIVRE', status: 'CONNECTED', nextSyncAt: new Date(0),
  syncLock: null, syncLockUntil: null, syncAttemptAt: null, syncFailures: 0, syncError: null, lastSyncAt: null, ...overrides })
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: any) => {
    if (key === 'AND') return value.every((condition: any) => matches(row, condition))
    if (key === 'OR') return value.some((condition: any) => matches(row, condition))
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, operand]: any) =>
      op === 'in' ? operand.includes(row[key]) : op === 'lt' ? row[key] !== null && row[key] < operand : op === 'lte' ? row[key] !== null && row[key] <= operand : false)
    return row[key] === value
  })
}
function store(rows: any[]) {
  return { marketplaceAccount: {
    findMany: vi.fn(async ({ where, take }: any) => rows.filter(row => matches(row, where)).slice(0, take).map(row => ({ ...row }))),
    findUnique: vi.fn(async ({ where }: any) => rows.find(row => row.id === where.id)),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const selected = rows.filter(row => matches(row, where))
      for (const row of selected) for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value
      return { count: selected.length }
    }),
  } } as any
}
const adapter = (): SyncAdapter => ({ marketplace: 'MERCADO_LIVRE', run: vi.fn(async () => ({ orders: 0, incomplete: 0 })) })
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T15:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it('imports a newly connected shop without a browser or manual request, then waits for the interval', async () => {
  const row = fixture(), connector = adapter(), db = store([row])
  const service = createSyncService(db, [connector], config)
  await service.processDue()
  expect(connector.run).toHaveBeenCalledOnce()
  expect(connector.run).toHaveBeenCalledWith(db, row.id, expect.any(Function), { lease: expect.any(String) })
  expect(row.nextSyncAt.getTime()).toBe(Date.now() + config.intervalMs)
  expect(row.syncLock).toBeNull()
  await service.processDue(); expect(connector.run).toHaveBeenCalledOnce()
  vi.setSystemTime(Date.now() + config.intervalMs)
  await service.processDue(); expect(connector.run).toHaveBeenCalledTimes(2)
})
it('reserves each account atomically across replicas and respects the configured concurrency', async () => {
  const rows = [fixture(), fixture({ id: 'second' }), fixture({ id: 'third' })], db = store(rows), connector = adapter()
  let active = 0, peak = 0
  vi.mocked(connector.run).mockImplementation(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { orders: 1, incomplete: 0 } })
  const a = createSyncService(db, [connector], config), b = createSyncService(db, [connector], config)
  await Promise.all([a.processDue(), a.processDue(), b.processDue()])
  expect(connector.run).toHaveBeenCalledTimes(2)
  expect(peak).toBeLessThanOrEqual(2)
  await a.processDue(); expect(connector.run).toHaveBeenCalledTimes(3)
})
it('recovers overdue work after a restart and refuses an unexpired lease', async () => {
  const row = fixture({ syncLock: 'crashed-worker', syncLockUntil: new Date(Date.now() + 1000) }), db = store([row]), connector = adapter()
  const service = createSyncService(db, [connector], config)
  await service.processDue(); expect(connector.run).not.toHaveBeenCalled()
  vi.setSystemTime(Date.now() + 1001)
  await createSyncService(db, [connector], config).processDue()
  expect(connector.run).toHaveBeenCalledOnce()
  expect(row.syncLock).toBeNull()
})
it('backs off transient failures, honors Retry-After, preserves last import and resets after recovery', async () => {
  const row = fixture({ lastSyncAt: new Date(Date.now() - 1000) }), original = row.lastSyncAt, db = store([row]), connector = adapter(), warn = vi.fn()
  vi.mocked(connector.run).mockRejectedValueOnce(new SyncError(429, 'Limite de consultas.', false, undefined, 900000))
    .mockRejectedValueOnce(new Error('private-token-must-not-log'))
  const service = createSyncService(db, [connector], config, fetch, warn)
  await service.processDue()
  expect(row.syncFailures).toBe(1); expect(row.lastSyncAt).toEqual(original)
  expect(row.nextSyncAt.getTime()).toBe(Date.now() + 900000)
  await service.processDue(); expect(connector.run).toHaveBeenCalledTimes(1)
  vi.setSystemTime(row.nextSyncAt)
  await service.processDue()
  expect(row.syncFailures).toBe(2); expect(row.nextSyncAt.getTime()).toBe(Date.now() + 600000)
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private-token')
  vi.setSystemTime(row.nextSyncAt); await service.processDue()
  expect(row.syncFailures).toBe(0); expect(row.syncError).toBeNull()
})
it('stops retrying revoked accounts and leaves unimplemented marketplaces untouched', async () => {
  const rows = [fixture(), fixture({ id: 'shopee', marketplace: 'SHOPEE' })], db = store(rows), connector = adapter()
  vi.mocked(connector.run).mockRejectedValue(new SyncError(409, 'Reconecte a loja.', true))
  const service = createSyncService(db, [connector], config)
  await service.processDue()
  expect(rows[0].status).toBe('EXPIRED'); expect(rows[0].nextSyncAt).toBeNull()
  expect(rows[1].syncAttemptAt).toBeNull()
  vi.setSystemTime(Date.now() + 86400000); await service.processDue()
  expect(connector.run).toHaveBeenCalledOnce()
  expect(service.describe(rows[1] as any).state).toBe('unsupported')
})
it('schedules a future marketplace by registration alone, without changing the worker', async () => {
  const row = fixture({ marketplace: 'AMAZON' }), run = vi.fn(async () => ({ orders: 1, incomplete: 0 }))
  await createSyncService(store([row]), [{ marketplace: 'AMAZON', run }], config).processDue()
  expect(run).toHaveBeenCalledOnce()
  expect(row.nextSyncAt.getTime()).toBe(Date.now() + config.intervalMs)
})
it('does not let a stale worker clear the reservation or error state of its successor', async () => {
  const row = fixture(), connector = adapter(), db = store([row])
  vi.mocked(connector.run).mockImplementation(async () => {
    row.syncLock = 'successor' as any; row.syncError = 'Successor result' as any
    return { orders: 0, incomplete: 0 }
  })
  await createSyncService(db, [connector], config).processDue()
  expect(row.syncLock).toBe('successor'); expect(row.syncError).toBe('Successor result')
})
it('manual refresh only queues work and refuses active, unsupported and revoked accounts', async () => {
  const row = fixture({ nextSyncAt: new Date(Date.now() + 999999) }), db = store([row]), connector = adapter()
  const service = createSyncService(db, [connector], config)
  await service.enqueue(row.id); expect(row.nextSyncAt.getTime()).toBe(Date.now())
  expect(connector.run).not.toHaveBeenCalled()
  row.syncLockUntil = new Date(Date.now() + 10000) as any
  await expect(service.enqueue(row.id)).rejects.toMatchObject({ code: 409 })
  row.syncLockUntil = null; row.status = 'EXPIRED'
  await expect(service.enqueue(row.id)).rejects.toMatchObject({ reconnect: true })
  row.status = 'CONNECTED'; row.marketplace = 'SHOPEE'
  await expect(service.enqueue(row.id)).rejects.toMatchObject({ code: 501 })
})
it('can be paused and validates configuration without starting provider requests', async () => {
  const row = fixture(), db = store([row]), connector = adapter()
  const service = createSyncService(db, [connector], { ...config, enabled: false })
  await service.processDue(); expect(db.marketplaceAccount.findMany).not.toHaveBeenCalled()
  await expect(service.enqueue(row.id)).rejects.toMatchObject({ code: 503 })
  expect(service.describe(row as any).state).toBe('disabled')
  vi.stubEnv('ORDER_SYNC_INTERVAL_MINUTES', '0'); expect(orderSyncConfiguration).toThrow()
})
it('aborts in-flight provider HTTP requests on shutdown and releases the reservation', async () => {
  const row = fixture(), connector = adapter(), db = store([row])
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const request = vi.fn((_input: any, init: any) => new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted'))); entered()
  })) as typeof fetch
  vi.mocked(connector.run).mockImplementation(async (_db, _id, request) => { await request('https://example.test'); return { orders: 0, incomplete: 0 } })
  const service = createSyncService(db, [connector], config, request)
  const processing = service.processDue(); await started; await service.close(); await processing
  expect(row.syncLock).toBeNull()
  await service.processDue(); expect(connector.run).toHaveBeenCalledOnce()
})
it('starts on server readiness, polls in the background and stops when the server closes', async () => {
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const app = Fastify()
  const service = { processDue: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  registerSyncWorker(app, service as any)
  try {
    await app.ready()
    expect(service.processDue).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(service.processDue).toHaveBeenCalledTimes(2)
    await app.close()
    expect(service.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10000)
    expect(service.processDue).toHaveBeenCalledTimes(2)
  } finally { await app.close() }
})
