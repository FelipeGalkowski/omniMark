import { useState } from 'react'
import { analyticsAvailable, readConsent, setAnalyticsConsent, type Consent } from './analytics'
import { btnPri, btnSec } from './ui'

export default function AnalyticsConsent() {
  const [open, setOpen] = useState(() => readConsent() === null)
  if (!analyticsAvailable()) return null
  function choose(value: Consent) { setAnalyticsConsent(value); setOpen(false) }
  return open ? <section className="analytics-consent" aria-label="Preferências de Analytics">
    <strong>Análise de uso do OmniMark</strong>
    <p>Podemos usar cookies do Google Analytics para entender as visitas e o uso das telas? A escolha é opcional e pode ser alterada em “Preferências de cookies”. <a href="/privacidade" target="_blank" rel="noreferrer">Política de privacidade</a></p>
    <div><button style={btnSec} onClick={() => choose('denied')}>Recusar</button><button style={btnPri} onClick={() => choose('granted')}>Aceitar Analytics</button></div>
  </section> : <button className="analytics-preferences" onClick={() => setOpen(true)}>Preferências de cookies</button>
}
