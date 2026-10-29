import { useEffect, useState } from 'react'
import { api } from './api'
import AuthLayout, { FormField, inputStyle, linkStyle, PasswordInput, submitBtn } from './AuthLayout'

export default function RecoveryInfo({ onBack, token }: { onBack: () => void; token?: string | null }) {
  const [requestMode, setRequestMode] = useState(!token)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || (requestMode && cooldown)) return
    setError(''); setMessage('')
    if (!requestMode && (password.length < 10 || password.length > 128)) { setError('A senha deve ter entre 10 e 128 caracteres.'); return }
    if (!requestMode && password !== confirm) { setError('As senhas não coincidem.'); return }
    setBusy(true)
    try {
      if (requestMode) {
        const result = await api<{ message: string; resendAfter: number }>('/auth/password/request', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
        setMessage(result.message); setCooldown(result.resendAfter)
      } else {
        await api('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) })
        setPassword(''); setConfirm(''); setDone(true)
      }
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }
  return <AuthLayout><div className="stack-form">
    <div><h1>{done ? 'Senha redefinida' : requestMode ? 'Recuperar acesso' : 'Crie uma nova senha'}</h1><p style={{ marginTop: 8 }}>{done ? 'Sua senha foi alterada e as sessões anteriores foram encerradas. Entre usando a nova senha.' : requestMode ? 'Informe seu e-mail para receber um link de recuperação válido por 30 minutos.' : 'Escolha uma senha de 10 a 128 caracteres para sua conta OmniMark.'}</p></div>
    {!done && <form className="stack-form" onSubmit={submit}>
      {requestMode ? <FormField label="E-mail"><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={254} placeholder="seu@email.com" style={inputStyle(false)} /></FormField> : <>
        <FormField label="Nova senha"><PasswordInput autoComplete="new-password" value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword(value => !value)} error={!!error} placeholder="Mínimo 10 caracteres" /></FormField>
        <FormField label="Confirmar nova senha"><PasswordInput autoComplete="new-password" value={confirm} onChange={setConfirm} show={showConfirm} onToggle={() => setShowConfirm(value => !value)} error={!!error} placeholder="Repita a nova senha" /></FormField>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="auth-feedback" role="status">{message}</p>}
      <button disabled={busy || (requestMode && cooldown > 0)} style={submitBtn}>{busy ? 'Aguarde…' : requestMode ? cooldown ? `Reenviar em ${cooldown} s` : 'Enviar link de recuperação' : 'Salvar nova senha'}</button>
    </form>}
    {!requestMode && !done && <button style={linkStyle} disabled={busy} onClick={() => { setRequestMode(true); setError(''); setPassword(''); setConfirm('') }}>Solicitar outro link</button>}
    <button onClick={onBack} disabled={busy} style={done ? submitBtn : linkStyle}>Voltar para entrar</button>
  </div></AuthLayout>
}
