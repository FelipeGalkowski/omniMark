import AuthLayout, { submitBtn } from './AuthLayout'

export default function RecoveryInfo({ onBack }: { onBack: () => void }) {
  return <AuthLayout><div className="stack-form">
    <h1>Recuperar acesso</h1>
    <p>A recuperação de senha por e-mail ainda não está disponível nesta versão do OmniMark.</p>
    <p>Para entrar, utilize sua senha atual.</p>
    <button onClick={onBack} style={submitBtn}>Voltar para entrar</button>
  </div></AuthLayout>
}
