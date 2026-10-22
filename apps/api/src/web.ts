import type { FastifyInstance } from 'fastify'
import staticFiles from '@fastify/static'
import { resolve } from 'node:path'

export function rewriteApiUrl(url: string) {
  return url.startsWith('/api/') ? url.slice(4) : url
}

export async function registerWeb(app: FastifyInstance, directory: string) {
  const root = resolve(directory)
  await app.register(staticFiles, { root, serve: false })
  app.get('/', { config: { rateLimit: false } }, (_request, reply) => reply.header('Cache-Control', 'no-store').sendFile('index.html'))
  app.get('/sandbox-product.jpg', { config: { rateLimit: false } }, (_request, reply) => reply.header('Cache-Control', 'public, max-age=3600').sendFile('sandbox-product.jpg'))
  await app.register(staticFiles, {
    root: resolve(root, 'assets'), prefix: '/assets/', decorateReply: false,
    immutable: true, maxAge: '1y',
  })
}
