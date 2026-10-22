import { expect, it } from 'vitest'
import { magaluDiagnosticMessage } from './magalu-diagnostic-message.js'

it('preserves the validation explanation in both documented formats and ignores inputs, buyer objects and arbitrary response fields', () => {
  expect(magaluDiagnosticMessage({ message: 'Unprocessable entity', details: [{ field: 'date_range', message: 'The date range must be at most 30 days.', input: 'private-input' }], customer: { message: 'private-buyer' } }, []))
    .toBe('Unprocessable entity | The date range must be at most 30 days.')
  expect(magaluDiagnosticMessage({ detail: [{ msg: 'Input should be less than or equal to 20', input: 'private-input' }] }, []))
    .toBe('Input should be less than or equal to 20')
})
it('removes known secrets, bearer tokens, JWTs, links, email addresses, identifiers and document numbers before truncation', () => {
  const message = 'client-secret short-secret Bearer access-token eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.signature https://example.test/?token=abc name@example.test 123.456.789-09 c36f9d61-241d-43c6-87ed-2faac6dc8ab1'
  const output = magaluDiagnosticMessage({ message, details: [{ message: 'x'.repeat(2000) + 'client-secret' }] }, ['client-secret', 'short-secret'])
  expect(output).not.toMatch(/client-secret|short-secret|access-token|eyJ|example|123\.456|c36f9d61/)
  expect(output.length).toBeLessThanOrEqual(1000)
})
it('handles malformed and nested errors without serializing the response or control characters', () => {
  expect(magaluDiagnosticMessage({ errors: [{ message: 'Invalid\nrange\u202e' }], input: 'private', unknown: { message: 'private' } }, [])).toBe('Invalid range ')
  expect(magaluDiagnosticMessage(null, [])).toContain('não contém mensagem')
})
