
export default function AuthLayout({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--pg)", padding: "24px 16px",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--t1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--sf)", letterSpacing: "-0.04em" }}>OM</span>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.025em" }}>Omnimark</span>
      </div>

      <div style={{
        width: "100%", maxWidth: wide ? 480 : 400,
        background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: 16,
        boxShadow: "0 4px 24px var(--shd)", padding: "32px 32px 28px",
      }}>
        {children}
      </div>

      <p style={{ marginTop: 20, fontSize: 11, color: "var(--t4)", textAlign: "center", maxWidth: 320 }}>
        OmniMark · Sua operação em um só lugar
      </p>
    </div>
  )
}


export function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ display: "contents" }}><span style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)" }}>{label}</span>{children}</label>
      {error && <span style={{ fontSize: 11, color: "#EF4444" }}>{error}</span>}
    </div>
  )
}

export function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "9px 12px", borderRadius: 8,
    border: `1.5px solid ${hasError ? "#EF4444" : "var(--bd)"}`,
    background: "var(--inp)", color: "var(--t1)", fontSize: 13,
    fontFamily: "'DM Sans', sans-serif", outline: "none",
    boxSizing: "border-box",
  }
}

export function PasswordInput({ value, onChange, show, onToggle, error, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; error: boolean; placeholder?: string
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        autoComplete="off"
        style={{ ...inputStyle(error), paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--t3)", fontSize: 13, padding: 2 }}
      >
        {show ? "🙈" : "👁"}
      </button>
    </div>
  )
}

export const submitBtn: React.CSSProperties = {
  width: "100%", padding: "10px 16px", borderRadius: 8, border: "none",
  background: "var(--pri)", color: "var(--pri-t)", fontSize: 14, fontWeight: 600,
  cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "opacity 0.15s",
}

export const linkStyle: React.CSSProperties = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  color: "var(--t2)", fontSize: 13, fontWeight: 600, textDecoration: "underline",
  fontFamily: "'DM Sans', sans-serif",
}
