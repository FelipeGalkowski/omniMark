import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { vault } from './mercadolivre.js'
import { magaluTenant } from './magalu.js'
import { magaluAccountContext, magaluEnvironment, magaluRequestHeaders, MAGALU_SANDBOX_CHANNEL } from './magalu-environment.js'
import { magaluDiagnostic } from './magalu-diagnostic.js'
import { magaluDiagnosticMessage } from './magalu-diagnostic-message.js'

const SKU = 'OMNIMARK-SANDBOX-001'
class SeedError extends Error {
  constructor(message: string, public diagnostic?: object) { super(message) }
}

export async function seedMagaluSandbox(db: PrismaClient, action: 'catalog' | 'order' | 'approve', request: typeof fetch = fetch, approvalTarget?: { code: string; deliveryIds: string[] }) {
  if (process.env.WEB_ORIGIN !== 'https://teste.omnimark.tech' || magaluEnvironment().environment !== 'SANDBOX') throw new SeedError('A geração de dados fictícios exige o stage e MAGALU_ENVIRONMENT=sandbox.')
  const accounts = await db.marketplaceAccount.findMany({ where: { marketplace: 'MAGALU', environment: 'SANDBOX', status: 'CONNECTED' }, include: { credentials: true }, take: 2 })
  if (accounts.length !== 1) throw new SeedError('Conecte exatamente uma conta Magalu de sandbox antes de gerar os dados de teste.')
  const account = accounts[0]
  const context = magaluAccountContext(account)
  if (!account.credentials || account.credentials.expiresAt.getTime() <= Date.now() + 90000) throw new SeedError('Aguarde a renovação automática da autorização Magalu antes de gerar dados de teste.')
  const tokens = z.object({ accessToken: z.string(), refreshToken: z.string() }).parse(JSON.parse(vault(process.env.TOKEN_ENCRYPTION_KEY ?? '').open(account.credentials.tokenCipher)))
  if (magaluTenant(tokens.accessToken) !== account.externalId) throw new SeedError('A autorização não corresponde à conta de sandbox.')
  const secrets = [tokens.accessToken, tokens.refreshToken, account.externalId, context.sellerId, process.env.MAGALU_CLIENT_SECRET ?? '', process.env.TOKEN_ENCRYPTION_KEY ?? '']
  const channel = { id: MAGALU_SANDBOX_CHANNEL }
  async function call(method: 'GET' | 'POST' | 'PUT', path: string, body?: object, allowMissing = false) {
    // This utility has no production fallback and never retries writes.
    const response = await request(`https://api-sandbox.magalu.com${path}`, { method, redirect: 'error',
      headers: { ...magaluRequestHeaders(tokens.accessToken, context), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
    const payload = await response.json().catch(() => null)
    if (response.status === 404 && allowMissing) return { missing: true, status: response.status, payload }
    if (!response.ok) throw new SeedError('A Magalu não concluiu a operação de teste.', {
      ...magaluDiagnostic(response, action === 'catalog' ? 'sandbox.catalog' : 'sandbox.order', payload), providerMessage: magaluDiagnosticMessage(payload, secrets),
    })
    return { missing: false, status: response.status, payload }
  }

  if (action === 'approve') {
    const code = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).parse(approvalTarget?.code)
    const deliveryIds = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(10).parse(approvalTarget?.deliveryIds)
    await call('PUT', `/v1/samples/orders/${encodeURIComponent(code)}`, { channel, deliveries: deliveryIds.map(deliveryId => ({ id: deliveryId })), status: 'approved' })
    return { state: 'approval_requested', code, message: 'Solicitação de aprovação do pedido fictício enviada. A rotina automática consultará o resultado.' }
  }

  if (action === 'catalog') {
    const existing = await call('GET', `/seller/v1/portfolios/skus/${SKU}`, undefined, true)
    if (existing.missing) {
      await call('POST', '/seller/v1/portfolios/skus', {
        sku: SKU, title: 'Produto fictício OmniMark - Sandbox', description: 'Produto criado exclusivamente para testar o TCC OmniMark no sandbox da Magalu.',
        brand: 'OmniMark Teste', group: { id: 'OMNIMARK-SANDBOX', main_variation: true }, channels: [channel],
        identifiers: [], has_ean: false, datasheet: [{ name: 'Finalidade', value: 'Teste de integração' }], attributes: [],
        dimensions: ['package', 'product'].map(name => ({ name, height: { unit: 'cm', value: 10 }, width: { unit: 'cm', value: 10 }, length: { unit: 'cm', value: 10 }, weight: { unit: 'g', value: 100 } })),
        images: [{ reference: 'https://teste.omnimark.tech/sandbox-product.jpg', type: 'image/jpeg' }], videos: [], podcasts: [], active: true, type: 'product', extra_data: [],
      })
      return { state: 'product_submitted', sku: SKU, message: 'Produto fictício enviado à Magalu. Aguarde o processamento e repita --catalog para preparar preço e estoque.' }
    }
    await call('POST', `/seller/v1/portfolios/prices/${SKU}`, { channel, currency: 'BRL', normalizer: 100, list_price: 9990, price: 9990 })
    await call('POST', `/seller/v1/portfolios/stocks/${SKU}`, { channel, quantity: 100, type: 'AVAILABLE' })
    return { state: 'catalog_submitted', sku: SKU, message: 'Preço de R$ 99,90 e estoque fictício enviados. Após o processamento da Magalu, execute --order uma vez para criar o pedido de teste.' }
  }

  const created = await call('POST', '/v1/samples/orders', { channel, deliveries: [{ items: [{ info: { sku: SKU }, quantity: 1 }] }], payments: [{ method: 'pix' }] })
  const payload = created.payload?.order ?? created.payload?.data ?? created.payload
  const result = z.object({ id: z.string().min(1).max(128).optional(), code: z.string().min(1).max(128).optional(), deliveries: z.array(z.object({ id: z.string().min(1).max(128) })).optional() }).safeParse(payload)
  let approval: 'requested' | 'pending' = 'pending'
  let approvalDiagnostic: object | undefined
  if (result.success && result.data.code && result.data.deliveries?.length) {
    try {
      // The samples route names its path parameter "id", but resolves the commercial code.
      await call('PUT', `/v1/samples/orders/${encodeURIComponent(result.data.code)}`, { channel, deliveries: result.data.deliveries.map(delivery => ({ id: delivery.id })), status: 'approved' })
      approval = 'requested'
    } catch (error) { if (error instanceof SeedError) approvalDiagnostic = error.diagnostic }
  }
  return { state: 'order_created', sku: SKU, ...(result.success ? { id: result.data.id, code: result.data.code, deliveryIds: result.data.deliveries?.map(delivery => delivery.id) } : {}), approval, approvalDiagnostic,
    message: approval === 'requested' ? 'Pedido fictício criado e aprovação solicitada. A rotina automática importará os dados.' : 'Pedido fictício criado. A aprovação ainda precisa ser confirmada; use --approve com o código do pedido (campo code) e os IDs das entregas, sem repetir --order.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2]
  if (action !== '--catalog' && action !== '--order' && action !== '--approve') { console.error('Use --catalog, --order ou --approve CODIGO_DO_PEDIDO ID_DA_ENTREGA [...].'); process.exitCode = 1 }
  else {
    const db = new PrismaClient()
    try { console.log(JSON.stringify(await seedMagaluSandbox(db, action === '--catalog' ? 'catalog' : action === '--order' ? 'order' : 'approve', fetch, action === '--approve' ? { code: process.argv[3], deliveryIds: process.argv.slice(4) } : undefined), null, 2)) }
    catch (error) { console.error(JSON.stringify(error instanceof SeedError ? { error: error.message, diagnostic: error.diagnostic } : { error: 'Não foi possível concluir a operação de sandbox. Nenhuma credencial foi exibida.' }, null, 2)); process.exitCode = 1 }
    finally { await db.$disconnect() }
  }
}
