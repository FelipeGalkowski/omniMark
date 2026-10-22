// For an operator's explicit stage probe only. Automatic logs stay allowlisted.
export function magaluDiagnosticMessage(payload: unknown, secrets: string[]): string {
  const messages: string[] = []
  function visit(value: unknown, depth: number) {
    if (depth > 4 || messages.length >= 8) return
    if (Array.isArray(value)) { for (const item of value.slice(0, 5)) visit(item, depth + 1); return }
    if (!value || typeof value !== 'object') return
    const error = value as Record<string, unknown>
    for (const key of ['message', 'msg', 'error_description']) if (typeof error[key] === 'string') messages.push(error[key] as string)
    if (typeof error.detail === 'string') messages.push(error.detail)
    for (const key of ['details', 'detail', 'errors', 'error']) visit(error[key], depth + 1)
  }
  visit(payload, 0)
  let text = [...new Set(messages)].slice(0, 8).join(' | ')
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]')
  return text
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[token]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b\d(?:[.()/+ -]?\d){5,}\b/g, '[number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 1000) || 'A resposta não contém mensagem de validação legível.'
}
