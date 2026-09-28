import { useState } from "react"
import { api, type UserRecord } from "./api"
import type { User } from "./auth"
import AuthLayout, { FormField, inputStyle, PasswordInput, submitBtn, linkStyle } from "./AuthLayout"

interface Props {
  onLogin: (user: User) => void
  onSignup: () => void
  onForgot: () => void
}

export default function LoginPage({ onLogin, onSignup, onForgot }: Props) {
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [showPw,   setShowPw]   = useState(false)
  const [errors,   setErrors]   = useState<Record<string, string>>({})
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit() {
    if (loading) return
    const errs: Record<string, string> = {}
    if (!email.trim()) errs.email = "Informe seu e-mail."
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) errs.email = "Formato de e-mail inválido."
    if (!password) errs.password = "Informe sua senha."
    else if (password.length < 10) errs.password = "Senha deve ter ao menos 10 caracteres."
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true); setErrors({})
    try {
      const result = await api<{ user: UserRecord }>('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) })
      onLogin({ ...result.user, isDemoUser: false })
    } catch (error) { setErrors({ form: (error as Error).message }) }
    finally { setLoading(false) }
  }

  function handleDemo() {
    onLogin({ id: 'demo', name: 'Usuário Demo', email: 'demo@omnimark.dev', isDemoUser: true })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit()
  }

  return (
    <AuthLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: 21, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.03em" }}>Bem-vindo de volta</h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--t3)" }}>Entre na sua conta Omnimark.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onKeyDown={handleKey}>
          <FormField label="E-mail" error={errors.email}>
            <input type="email" value={email} autoFocus
              onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: "" })) }}
              placeholder="seu@email.com" style={inputStyle(!!errors.email)} />
          </FormField>

          <FormField label="Senha" error={errors.password}>
            <PasswordInput value={password} onChange={v => { setPassword(v); setErrors(p => ({ ...p, password: "" })) }}
              show={showPw} onToggle={() => setShowPw(v => !v)} error={!!errors.password} />
          </FormField>

          <div style={{ textAlign: "right", marginTop: -4 }}>
            <button onClick={onForgot} style={linkStyle}>Esqueci minha senha</button>
          </div>
        </div>

        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={handleSubmit} disabled={loading} style={{ ...submitBtn, opacity: loading ? 0.7 : 1 }}>
            {loading ? "Entrando…" : "Entrar"}
          </button>

          <Divider />

          <button onClick={handleDemo} disabled={loading} style={{ ...submitBtn, background: "var(--sf3)", color: "var(--t2)", border: "1.5px solid var(--bd)" }}>
            Explorar demonstração
          </button>
        </div>

        <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "var(--t3)" }}>
          Não tem conta?{" "}
          <button onClick={onSignup} style={linkStyle}>Criar conta</button>
        </p>
      </div>
    </AuthLayout>
  )
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: "var(--bd)" }} />
      <span style={{ fontSize: 11, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em" }}>OU</span>
      <div style={{ flex: 1, height: 1, background: "var(--bd)" }} />
    </div>
  )
}
