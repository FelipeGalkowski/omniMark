import { useEffect, useState } from 'react'
import { api } from './api'
import AuthLayout, { FormField, inputStyle, linkStyle, submitBtn } from './AuthLayout'

export default function VerifyEmailPage({ email, onVerified, onBack }: { email: string; onVerified: () => void; onBack: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(60)
  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(''); setMessage('')
    if (!/^\d{6}$/.test(code)) { setError('Informe os seis dígitos do código.'); return }
    setBusy(true)
    try {
      await api('/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) })
      setCode(''); onVerified()
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }
  async function resend() {
    if (busy || cooldown) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<{ message: string; resendAfter: number }>('/auth/email/request', { method: 'POST', body: JSON.stringify({ email }) })
      setCode(''); setMessage(result.message); setCooldown(result.resendAfter)
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }
  return <AuthLayout><div className="stack-form">
    <div><h1>Confirme seu e-mail</h1><p style={{ marginTop: 8 }}>Digite o código enviado para <strong style={{ color: 'var(--t1)', overflowWrap: 'anywhere' }}>{email}</strong>. Ele é válido por 10 minutos.</p></div>
    <form onSubmit={verify} className="stack-form">
      <FormField label="Código de confirmação"><input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} required pattern="[0-9]{6}" placeholder="000000" style={{ ...inputStyle(!!error), fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.35em', textAlign: 'center', fontSize: 24 }} /></FormField>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="auth-feedback" role="status">{message}</p>}
      <button disabled={busy} style={submitBtn}>{busy ? 'Aguarde…' : 'Confirmar e-mail'}</button>
    </form>
    <p>Não recebeu? Confira a pasta de spam. Ao reenviar, o código anterior deixa de funcionar.</p>
    <button onClick={resend} disabled={busy || cooldown > 0} style={linkStyle}>{cooldown ? `Reenviar em ${cooldown} s` : 'Reenviar código'}</button>
    <button onClick={onBack} disabled={busy} style={linkStyle}>Voltar para entrar</button>
  </div></AuthLayout>
}
