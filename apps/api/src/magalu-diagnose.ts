import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { vault } from './mercadolivre.js'
import { magaluTenant } from './magalu.js'
import { magaluDateRanges, magaluDiagnostic } from './magalu-sync.js'
import { magaluDiagnosticMessage } from './magalu-diagnostic-message.js'
import { magaluEnvironment, magaluAccountContext, magaluRequestHeaders } from './magalu-environment.js'

class DiagnosticError extends Error {}

// Operator-only probe: one GET, no refresh, import, database writes or scheduler changes.
export async function diagnoseMagalu(db: PrismaClient, request: typeof fetch = fetch) {
  if (process.env.WEB_ORIGIN !== 'https://teste.omnimark.tech') throw new DiagnosticError('Este diagnóstico está restrito ao ambiente de stage.')
  const accounts = await db.marketplaceAccount.findMany({ where: { marketplace: 'MAGALU', status: 'CONNECTED', environment: magaluEnvironment().environment }, include: { credentials: true }, take: 2 })
  if (accounts.length !== 1) throw new DiagnosticError('O diagnóstico precisa de exatamente uma conta Magalu conectada no stage.')
  const account = accounts[0]
  let context: ReturnType<typeof magaluAccountContext>
  try { context = magaluAccountContext(account) } catch { throw new DiagnosticError('Conecte uma conta Magalu no ambiente atual e conclua o cadastro de sandbox antes do diagnóstico.') }
  if (!account.credentials || account.credentials.expiresAt.getTime() <= Date.now() + 30000) throw new DiagnosticError('Aguarde a renovação automática da autorização Magalu antes de repetir o diagnóstico.')
  const tokens = z.object({ accessToken: z.string().min(1), refreshToken: z.string().optional() }).parse(JSON.parse(vault(process.env.TOKEN_ENCRYPTION_KEY ?? '').open(account.credentials.tokenCipher)))
  if (magaluTenant(tokens.accessToken) !== account.externalId) throw new DiagnosticError('A autorização não corresponde à loja conectada.')
  const to = new Date(), historyStart = new Date(to)
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 1)
  const fullSync = !account.lastFullSyncAt || !account.syncTo || to.getTime() - account.lastFullSyncAt.getTime() >= 86400_000
  const from = fullSync ? historyStart : new Date(Math.max(historyStart.getTime(), account.syncTo!.getTime() - 15 * 60_000))
  const field = fullSync ? 'purchased_at' : 'updated_at'
  const [range] = magaluDateRanges(from, to)
  const query = new URLSearchParams({ [`${field}__gte`]: range.from.toISOString(), [`${field}__lte`]: range.to.toISOString(), _limit: '50', _offset: '0', _sort: 'purchased_at:asc' })
  const response = await request(`${context.baseUrl}/seller/v1/orders?${query}`, { redirect: 'error', headers: magaluRequestHeaders(tokens.accessToken, context), signal: AbortSignal.timeout(20000) })
  if (response.ok) {
    await response.body?.cancel()
    return { operation: 'magalu.orders.list', providerStatus: response.status, detail: 'Consulta aceita pela Magalu. Diagnóstico concluído sem importar dados.' }
  }
  const payload = await response.json().catch(() => null)
  return { ...magaluDiagnostic(response, 'orders.list', payload), providerMessage: magaluDiagnosticMessage(payload,
    [tokens.accessToken, tokens.refreshToken ?? '', account.externalId, process.env.MAGALU_CLIENT_ID ?? '', process.env.MAGALU_CLIENT_SECRET ?? '', process.env.TOKEN_ENCRYPTION_KEY ?? '', process.env.DATABASE_URL ?? '']) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new PrismaClient()
  try { console.log(JSON.stringify(await diagnoseMagalu(db), null, 2)) }
  catch (error) {
    console.error(error instanceof DiagnosticError ? error.message : 'Não foi possível concluir o diagnóstico. Nenhum token ou erro interno foi exibido.')
    process.exitCode = 1
  } finally { await db.$disconnect() }
}
