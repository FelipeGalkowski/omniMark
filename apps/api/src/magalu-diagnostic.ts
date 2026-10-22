import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const diagnosticFields = new Set(['status', 'purchased_at__gte', 'purchased_at__lte', 'updated_at__gte', 'updated_at__lte', 'code', '_limit', '_offset', '_sort', 'X-Channel-Id', 'x-channel-id', 'X-Tenant-Id', 'x-tenant-id'])
const diagnosticSlugs = new Set(['BAD_REQUEST', 'UNPROCESSABLE_ENTITY', 'INVALID_PARAMETER', 'INVALID_PARAMETER_VALUE', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'TOO_MANY_REQUESTS', 'SERVER_ERROR', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE', 'GATEWAY_TIMEOUT'])
const validationIssue = z.object({ field: z.string().optional(), slug: z.string().optional(),
  loc: z.array(z.union([z.string(), z.number()])).optional(), location: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).optional() })
const validationError = z.object({ detail: z.array(validationIssue).optional(), slug: z.string().optional(), details: z.array(validationIssue).optional() })
const oauthError = z.object({ error: z.enum(['invalid_grant', 'invalid_client', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope']) })
export function magaluDiagnostic(response: Response, operation: 'orders.list' | 'oauth.refresh' | 'sandbox.onboarding' | 'sandbox.catalog' | 'sandbox.order', payload: unknown) {
  const validation = validationError.safeParse(payload)
  const issues = validation.success ? [...(validation.data.detail ?? []), ...(validation.data.details ?? [])] : []
  const locations = issues.flatMap(issue => [...(issue.loc ?? []), ...(Array.isArray(issue.location) ? issue.location : issue.location ? [issue.location] : []), ...(issue.field ? [issue.field] : [])])
    .filter((part): part is string => typeof part === 'string')
  const fields = [...new Set(locations.flatMap(part => part.split(/[,.\s]+/)).filter(part => diagnosticFields.has(part)))].sort()
  const slugs = validation.success ? [...new Set([validation.data.slug, ...(validation.data.details ?? []).map(issue => issue.slug)]
    .filter((slug): slug is string => !!slug && diagnosticSlugs.has(slug)))].sort() : []
  const oauth = operation === 'oauth.refresh' ? oauthError.safeParse(payload) : null
  // Allowlisted metadata only: never copy messages, inputs, tokens, URLs or buyer data.
  const reason = [fields.length ? `Campos rejeitados: ${fields.join(', ')}.` : '', slugs.length ? `Regras: ${slugs.join(', ')}.` : ''].filter(Boolean).join(' ')
  const providerReference = z.string().uuid().safeParse(response.headers.get('x-request-id'))
  return { reference: providerReference.success ? providerReference.data : randomUUID(), operation: `magalu.${operation}`, providerStatus: response.status,
    detail: reason || (oauth?.success ? `OAuth: ${oauth.data.error}.` : 'Resposta recusada pela API Magalu.') }
}
