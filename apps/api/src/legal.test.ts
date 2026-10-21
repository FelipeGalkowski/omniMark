import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { registerLegalPages } from './legal.js'

afterEach(() => vi.unstubAllEnvs())
it('serves public documents with responsive HTML and clear test-environment limitations', async () => {
  const app = Fastify(); registerLegalPages(app)
  try {
    for (const path of ['/termos', '/privacidade']) {
      const response = await app.inject(path)
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['x-robots-tag']).toContain('noindex')
      expect(response.body).toContain('name="viewport"')
      expect(response.body).toContain('Versão provisória para revisão')
      expect(response.body).toContain('Felipe Galkowski')
      expect(response.body).toContain('mailto:felipegalk@outlook.com')
      expect(response.body).toContain('href="/"')
      expect(response.body).not.toContain('<script')
    }
    expect((await app.inject('/privacidade')).body).toContain('ciclo de descarte')
    expect((await app.inject('/termos')).body).toContain('não revoga')
  } finally { await app.close() }
})
it('uses a configured public contact without interpreting HTML', async () => {
  vi.stubEnv('LEGAL_CONTACT_EMAIL', 'contato+<teste>@example.test')
  const app = Fastify(); registerLegalPages(app)
  try {
    const response = await app.inject('/privacidade')
    expect(response.body).toContain('contato+&lt;teste&gt;@example.test')
    expect(response.body).not.toContain('<teste>')
  } finally { await app.close() }
})
