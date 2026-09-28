import { useState } from "react"
import { useAuth } from "./auth"
import { api } from './api'
import { inputStyle, PasswordInput } from "./AuthLayout"

export default function MyAccountPage() {
  const { user, updateUser } = useAuth()

  const [name,     setName]     = useState(user.name)
  const [nameMsg,  setNameMsg]  = useState("")
  const [nameSaved,setNameSaved]= useState(false)

  const [showPwForm, setShowPwForm] = useState(false)
  const [curPw,      setCurPw]      = useState("")
  const [newPw,      setNewPw]      = useState("")
  const [confirmPw,  setConfirmPw]  = useState("")
  const [showCur,    setShowCur]    = useState(false)
  const [showNew,    setShowNew]    = useState(false)
  const [showCf,     setShowCf]     = useState(false)
  const [pwErrors,   setPwErrors]   = useState<Record<string, string>>({})
  const [pwMsg,      setPwMsg]      = useState("")
  const [saving,     setSaving]     = useState(false)

  async function saveName() {
    if (saving) return
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 120) { setNameMsg("Informe um nome entre 2 e 120 caracteres."); return }
    setSaving(true); setNameSaved(false); setNameMsg('')
    try { await updateUser({ name: trimmed }); setNameSaved(true) }
    catch (error) { setNameMsg((error as Error).message) }
    finally { setSaving(false) }
  }

  async function savePassword() {
    if (saving || user.isDemoUser) return
    const errs: Record<string, string> = {}
    if (!curPw) errs.cur = "Informe a senha atual."
    if (newPw.length < 10 || newPw.length > 128) errs.new = "A nova senha deve ter entre 10 e 128 caracteres."
    if (!confirmPw) errs.confirm = "Confirme a nova senha."
    else if (confirmPw !== newPw) errs.confirm = "As senhas não coincidem."
    if (Object.keys(errs).length) { setPwErrors(errs); return }

    setSaving(true); setPwErrors({}); setPwMsg('')
    try {
      await api('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: curPw, password: newPw }) })
      setCurPw(""); setNewPw(""); setConfirmPw("")
      setPwErrors({})
      setShowPwForm(false)
      setPwMsg("Senha alterada. As outras sessões da sua conta foram encerradas.")
    } catch (error) { setPwErrors({ form: (error as Error).message }) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: "28px", maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.025em" }}>Minha conta</h1>
      <p style={{ margin: "0 0 28px", fontSize: 13, color: "var(--t3)" }}>Gerencie seus dados de perfil.</p>

      <Section title="Perfil">
        <Field label="Nome">
          <input value={name} onChange={e => { setName(e.target.value); setNameMsg("") }}
            style={inputStyle(!!nameMsg)} placeholder="Seu nome" />
          {nameMsg && <span style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>{nameMsg}</span>}
        </Field>
        <Field label="E-mail">
          <div style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--bd)", background: "var(--sf2)", fontSize: 13, color: "var(--t3)", fontFamily: "'DM Sans',sans-serif" }}>
            {user.email}
          </div>
          <span style={{ fontSize: 11, color: "var(--t3)", marginTop: 4, display: "block" }}>O e-mail não pode ser alterado nesta versão.</span>
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={saveName} disabled={saving} style={{ ...actionBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
          {nameSaved && (
            <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>✓ Salvo!</span>
          )}
        </div>
      </Section>

      <Section title="Senha">
        {pwMsg && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#166534", marginBottom: 4 }}>
            ✓ {pwMsg}
          </div>
        )}

        {!showPwForm ? (
          <button disabled={user.isDemoUser} onClick={() => setShowPwForm(true)} style={{ ...outlineBtn }}>
            {user.isDemoUser ? 'Alteração de senha indisponível na demonstração' : 'Alterar senha'}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <PwField label="Senha atual" value={curPw} onChange={v => { setCurPw(v); setPwErrors(p => ({ ...p, cur: "" })) }}
              show={showCur} onToggle={() => setShowCur(v => !v)} error={pwErrors.cur} />
            <PwField label="Nova senha" value={newPw} onChange={v => { setNewPw(v); setPwErrors(p => ({ ...p, new: "" })) }}
              show={showNew} onToggle={() => setShowNew(v => !v)} error={pwErrors.new} />
            <PwField label="Confirmar nova senha" value={confirmPw} onChange={v => { setConfirmPw(v); setPwErrors(p => ({ ...p, confirm: "" })) }}
              show={showCf} onToggle={() => setShowCf(v => !v)} error={pwErrors.confirm} />

            {pwErrors.form && <p className="form-error" role="alert">{pwErrors.form}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={savePassword} disabled={saving} style={{ ...actionBtn, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Salvando…" : "Salvar senha"}
              </button>
              <button onClick={() => { setShowPwForm(false); setCurPw(""); setNewPw(""); setConfirmPw(""); setPwErrors({}) }} style={outlineBtn}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </Section>

      {user.isDemoUser && (
        <div style={{ background: "var(--sf3)", border: "1px solid var(--bd)", borderRadius: 10, padding: "14px 16px" }}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--t3)" }}>
            <strong>Modo demonstração</strong> — você está usando o perfil de demonstração com dados fictícios. Crie uma conta para salvar suas configurações.
          </p>
        </div>
      )}
    </div>
  )
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: 14, padding: "20px 22px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)" }}>{label}</label>
      {children}
    </div>
  )
}

function PwField({ label, value, onChange, show, onToggle, error }: {
  label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; error?: string
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)" }}>{label}</label>
      <PasswordInput value={value} onChange={onChange} show={show} onToggle={onToggle} error={!!error} />
      {error && <span style={{ fontSize: 11, color: "#EF4444" }}>{error}</span>}
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  padding: "8px 18px", borderRadius: 8, border: "none",
  background: "var(--pri)", color: "var(--pri-t)", fontSize: 13, fontWeight: 600,
  cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
}

const outlineBtn: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 8, border: "1.5px solid var(--bd)",
  background: "transparent", color: "var(--t1)", fontSize: 13, fontWeight: 500,
  cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
}
