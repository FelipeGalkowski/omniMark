import { useState } from 'react'
import type { User } from './auth'
import { formatCNPJ, validateCNPJ, type Company } from './data'
import { FormField, inputStyle, submitBtn } from './AuthLayout'

export default function WelcomePage({ user, onCreate }: { user: User; onCreate: (company: Omit<Company, 'id'>) => Promise<void> }) {
  const [started, setStarted] = useState(false)
  const [name, setName] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const next: Record<string, string> = {}
    if (name.trim().length < 2 || name.trim().length > 120) next.name = 'Informe um nome entre 2 e 120 caracteres.'
    if (cnpj && !validateCNPJ(cnpj)) next.cnpj = 'Confira o formato do CNPJ.'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try { await onCreate({ name, razaoSocial, cnpj }) }
    catch (error) { setErrors({ form: (error as Error).message }) }
    finally { setSaving(false) }
  }
  return <div className="welcome-page"><section className="welcome-card">
    {!started ? <div className="welcome-intro">
      <span aria-hidden="true" style={{ fontSize:48 }}>👋</span>
      <h1>Bem-vindo ao Omnimark, {user.name.split(' ')[0]}</h1>
      <p>Cadastre sua empresa para organizar suas contas de marketplace em um só lugar.</p>
      <button style={submitBtn} onClick={() => setStarted(true)}>Cadastrar primeira empresa →</button>
      <small>As integrações com marketplaces serão disponibilizadas em uma próxima etapa.</small>
    </div> : <form onSubmit={submit} className="stack-form">
      <h1>Cadastre sua empresa</h1>
      <p>Você poderá editar essas informações depois.</p>
      <FormField label="Nome de exibição *" error={errors.name}><input autoFocus required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Ex: TechStore Brasil" style={inputStyle(!!errors.name)} /></FormField>
      <FormField label="Razão social"><input maxLength={200} value={razaoSocial} onChange={event => setRazaoSocial(event.target.value)} placeholder="Opcional" style={inputStyle(false)} /></FormField>
      <FormField label="CNPJ" error={errors.cnpj}><input value={cnpj} onChange={event => setCnpj(formatCNPJ(event.target.value))} placeholder="XX.XXX.XXX/XXXX-XX (opcional)" style={inputStyle(!!errors.cnpj)} /></FormField>
      {errors.form && <p role="alert" className="form-error">{errors.form}</p>}
      <button disabled={saving} style={submitBtn}>{saving ? 'Cadastrando…' : 'Cadastrar empresa'}</button>
    </form>}
  </section></div>
}
