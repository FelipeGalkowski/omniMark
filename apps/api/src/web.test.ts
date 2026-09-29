import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { expect, it } from 'vitest'
import { registerWeb, rewriteApiUrl } from './web.js'

it('serves the panel and assets without masking API errors or exposing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omnimark-web-'))
  const app = Fastify({ rewriteUrl: req => rewriteApiUrl(req.url ?? '/') })
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'index.html'), '<html>OmniMark</html>')
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("ready")')
    await writeFile(join(root, '.env'), 'private')
    app.get('/health', () => ({ status: 'ok' }))
    app.get('/integrations/mercadolivre/callback', req => req.query)
    await registerWeb(app, root)
    expect((await app.inject('/')).body).toContain('OmniMark')
    expect((await app.inject('/assets/app.js')).headers['cache-control']).toContain('immutable')
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok' })
    expect((await app.inject('/integrations/mercadolivre/callback?state=example')).json()).toEqual({ state: 'example' })
    for (const url of ['/api/missing', '/.env', '/assets/missing.js']) expect((await app.inject(url)).statusCode).toBe(404)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
