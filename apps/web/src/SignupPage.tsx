import { Icon } from './Icon'
import { useState } from "react"
import { api, type UserRecord } from "./api"
import type { User } from "./auth"
import AuthLayout, { FormField, inputStyle, PasswordInput, submitBtn, linkStyle } from "./AuthLayout"

interface Props {
  onLogin: (user: User) => void
  onBack: () => void
}

function pwStrength(pw: string): { ok: boolean; msg: string }[] {
  return [
    { ok: pw.length >= 10, msg: "Mínimo 10 caracteres" },
    { ok: pw.length <= 128, msg: "Até 128 caracteres" },
  ]
}

export default function SignupPage({ onLogin, onBack }: Props) {
  const [name,    setName]    = useState("")
  const [email,   setEmail]   = useState("")
  const [pw,      setPw]      = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPw,  setShowPw]  = useState(false)
  const [showCf,  setShowCf]  = useState(false)
  const [errors,  setErrors]  = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const reqs = pwStrength(pw)

  function validate() {
    const errs: Record<string, string> = {}
    if (name.trim().length < 2 || name.trim().length > 120) errs.name = "Informe um nome entre 2 e 120 caracteres."
    if (!email.trim()) errs.email = "Informe seu e-mail."
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) errs.email = "Formato de e-mail inválido."
    if (!pw) errs.pw = "Crie uma senha."
    else if (!reqs.every(r => r.ok)) errs.pw = "A senha não atende aos requisitos."
    if (!confirm) errs.confirm = "Confirme sua senha."
    else if (confirm !== pw) errs.confirm = "As senhas não coincidem."
    return errs
  }

  async function handleSubmit() {
    if (loading) return
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true); setErrors({})
    try {
      const result = await api<{ user: UserRecord }>('/auth/register', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim(), password: pw }) })
      onLogin({ ...result.user, isDemoUser: false })
    } catch (error) { setErrors({ form: (error as Error).message }) }
    finally { setLoading(false) }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit()
  }

  return (
    <AuthLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: 21, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.03em" }}>Criar sua conta</h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--t3)" }}>Comece a acompanhar suas vendas em marketplaces.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onKeyDown={handleKey}>
          <FormField label="Nome" error={errors.name}>
            <input value={name} autoFocus onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: "" })) }}
              placeholder="Seu nome" style={inputStyle(!!errors.name)} />
          </FormField>

          <FormField label="E-mail" error={errors.email}>
            <input type="email" value={email} onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: "" })) }}
              placeholder="seu@email.com" style={inputStyle(!!errors.email)} />
          </FormField>

          <FormField label="Senha" error={errors.pw}>
            <PasswordInput value={pw} onChange={v => { setPw(v); setErrors(p => ({ ...p, pw: "" })) }}
              show={showPw} onToggle={() => setShowPw(v => !v)} error={!!errors.pw} placeholder="Mínimo 10 caracteres" />
            {pw.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {reqs.map(r => (
                  <span key={r.msg} style={{ fontSize: 11, color: r.ok ? "#16a34a" : "var(--t4)", display: "flex", alignItems: "center", gap: 3 }}>
                    <Icon name={r.ok ? "check" : "circle"} size={12} /> {r.msg}
                  </span>
                ))}
              </div>
            )}
            {pw.length === 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {reqs.map(r => (
                  <span key={r.msg} style={{ fontSize: 11, color: "var(--t4)", display: "flex", alignItems: "center", gap: 3 }}><Icon name="circle" size={12} /> {r.msg}</span>
                ))}
              </div>
            )}
          </FormField>

          <FormField label="Confirmar senha" error={errors.confirm}>
            <PasswordInput value={confirm} onChange={v => { setConfirm(v); setErrors(p => ({ ...p, confirm: "" })) }}
              show={showCf} onToggle={() => setShowCf(v => !v)} error={!!errors.confirm} placeholder="Repita a senha" />
          </FormField>
        </div>

        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <button onClick={handleSubmit} disabled={loading} style={{ ...submitBtn, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Criando conta…" : "Criar conta"}
        </button>

        <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "var(--t3)" }}>
          Já tem conta?{" "}
          <button onClick={onBack} style={linkStyle}>Entrar</button>
        </p>
      </div>
    </AuthLayout>
  )
}
