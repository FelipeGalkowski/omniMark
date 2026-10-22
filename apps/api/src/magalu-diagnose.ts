import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { vault } from './mercadolivre.js'
import { magaluTenant } from './magalu.js'
import { magaluDiagnostic } from './magalu-sync.js'

class DiagnosticError extends Error {}

// Operator-only probe: one GET, no refresh, import, database writes or scheduler changes.
export async function diagnoseMagalu(db: PrismaClient, request: typeof fetch = fetch) {
  if (process.env.WEB_ORIGIN !== 'https://teste.omnimark.tech') throw new DiagnosticError('Este diagnóstico está restrito ao ambiente de stage.')
  const accounts = await db.marketplaceAccount.findMany({ where: { marketplace: 'MAGALU', status: 'CONNECTED' }, include: { credentials: true }, take: 2 })
  if (accounts.length !== 1) throw new DiagnosticError('O diagnóstico precisa de exatamente uma conta Magalu conectada no stage.')
  const account = accounts[0]
  if (!account.credentials || account.credentials.expiresAt.getTime() <= Date.now() + 30000) throw new DiagnosticError('Aguarde a renovação automática da autorização Magalu antes de repetir o diagnóstico.')
  const tokens = z.object({ accessToken: z.string().min(1) }).parse(JSON.parse(vault(process.env.TOKEN_ENCRYPTION_KEY ?? '').open(account.credentials.tokenCipher)))
  if (magaluTenant(tokens.accessToken) !== account.externalId) throw new DiagnosticError('A autorização não corresponde à loja conectada.')
  const to = new Date(), historyStart = new Date(to)
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 1)
  const fullSync = !account.lastFullSyncAt || !account.syncTo || to.getTime() - account.lastFullSyncAt.getTime() >= 86400_000
  const from = fullSync ? historyStart : new Date(Math.max(historyStart.getTime(), account.syncTo!.getTime() - 15 * 60_000))
  const field = fullSync ? 'purchased_at' : 'updated_at'
  const query = new URLSearchParams({ [`${field}__gte`]: from.toISOString(), [`${field}__lte`]: to.toISOString(), _limit: '50', _offset: '0', _sort: 'purchased_at:asc' })
  const response = await request(`https://api.magalu.com/seller/v1/orders?${query}`, { redirect: 'error', headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(20000) })
  if (response.ok) {
    await response.body?.cancel()
    return { operation: 'magalu.orders.list', providerStatus: response.status, detail: 'Consulta aceita pela Magalu. Diagnóstico concluído sem importar dados.' }
  }
  return magaluDiagnostic(response, 'orders.list', await response.json().catch(() => null))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new PrismaClient()
  try { console.log(JSON.stringify(await diagnoseMagalu(db), null, 2)) }
  catch (error) {
    console.error(error instanceof DiagnosticError ? error.message : 'Não foi possível concluir o diagnóstico. Nenhum token ou erro interno foi exibido.')
    process.exitCode = 1
  } finally { await db.$disconnect() }
}
