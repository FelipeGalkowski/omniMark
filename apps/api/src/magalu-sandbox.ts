import { z } from 'zod'
import { magaluEnvironment, MAGALU_SANDBOX_CHANNEL } from './magalu-environment.js'
import { SyncError } from './order-sync.js'
import { magaluDiagnostic } from './magalu-diagnostic.js'

export async function onboardMagaluSandbox(accessToken: string, authorizationTenant: string, request: typeof fetch) {
  const config = magaluEnvironment()
  if (config.environment !== 'SANDBOX') throw new Error('MAGALU_SANDBOX_DISABLED')
  const response = await request(`${config.baseUrl}/v1/samples/onboarding`, {
    method: 'PUT', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Tenant-Id': `GENPUB.${authorizationTenant}` },
    body: JSON.stringify({ channel_id: MAGALU_SANDBOX_CHANNEL }), signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new SyncError(502, 'O cadastro do vendedor fictício não foi concluído pela Magalu. Confira a audiência de sandbox e as permissões do client no ID Magalu.', false,
    magaluDiagnostic(response, 'sandbox.onboarding', await response.json().catch(() => null)))
  const result = z.object({ seller_id: z.string().regex(/^GENPUB\.[0-9a-f-]+$/i), channel_id: z.literal(MAGALU_SANDBOX_CHANNEL) }).parse(await response.json())
  return { sellerId: z.string().uuid().parse(result.seller_id.replace(/^GENPUB\./i, '')).toLowerCase(), channelId: result.channel_id }
}
