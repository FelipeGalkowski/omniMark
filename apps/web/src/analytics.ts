// Public measurement ID supplied for the stage. Keep production data separate.
export const MEASUREMENT_ID = 'G-9Y6DVJWVG3'
export const CONSENT_KEY = 'omnimark_analytics_consent_v1'
export type Consent = 'granted' | 'denied'
export const SCREENS = {
  login: 'Entrar', signup: 'Cadastro', forgot: 'Recuperar senha', verify: 'Confirmar e-mail',
  overview: 'Visão Geral', orders: 'Pedidos', accounts: 'Contas', myaccount: 'Minha conta', onboarding: 'Criar empresa',
} as const
export type Screen = keyof typeof SCREENS

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

let consent: Consent | null = readConsent()
let initialized = false
let currentScreen: Screen | null = null
let lastScreen: Screen | null = null
const consentListeners = new Set<(value: Consent | null) => void>()
export function analyticsAvailable() { return window.location.hostname === 'teste.omnimark.tech' }
function storedConsent(): Consent | null | undefined {
  try { const value = localStorage.getItem(CONSENT_KEY); return value === 'granted' || value === 'denied' ? value : null }
  catch { return undefined }
}
export function readConsent(): Consent | null {
  return storedConsent() ?? null
}
function syncConsent() {
  const value = storedConsent()
  if (value !== undefined && value !== consent) applyConsent(value)
}
export function subscribeAnalyticsConsent(listener: (value: Consent | null) => void) {
  consentListeners.add(listener)
  const onStorage = (event: StorageEvent) => { if (event.key === CONSENT_KEY || event.key === null) syncConsent() }
  window.addEventListener('storage', onStorage)
  syncConsent()
  return () => { consentListeners.delete(listener); window.removeEventListener('storage', onStorage) }
}
function initialize() {
  if (initialized || !analyticsAvailable() || consent !== 'granted') return
  initialized = true
  ;(window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`] = false
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer!.push(arguments) }
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  window.gtag('js', new Date())
  window.gtag('config', MEASUREMENT_ID, {
    send_page_view: false, page_location: `${window.location.origin}/`, page_referrer: '', page_title: 'OmniMark',
    allow_google_signals: false, allow_ad_personalization_signals: false,
    cookie_domain: 'none', cookie_expires: 60 * 60 * 24 * 365,
  })
  const script = document.createElement('script')
  script.id = 'omnimark-google-analytics'
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)
}
export function trackScreen(screen: Screen) {
  currentScreen = screen
  syncConsent()
  if (consent !== 'granted' || !analyticsAvailable()) return
  initialize()
  if (lastScreen === screen) return
  window.gtag?.('set', { page_location: `${window.location.origin}/${screen}`, page_title: SCREENS[screen], page_referrer: '' })
  window.gtag?.('event', 'page_view', { page_location: `${window.location.origin}/${screen}`, page_title: SCREENS[screen], page_referrer: '' })
  lastScreen = screen
}
export function trackEvent(event: 'login' | 'demo_start' | 'marketplace_connect_start', marketplace?: 'mercadolivre' | 'magalu' | 'shopee') {
  syncConsent()
  if (consent !== 'granted' || !analyticsAvailable()) return
  initialize()
  window.gtag?.('event', event, marketplace ? { marketplace } : {})
}
export function setAnalyticsConsent(value: Consent) {
  try { localStorage.setItem(CONSENT_KEY, value) } catch { /* Keep the choice for this page when storage is unavailable. */ }
  applyConsent(value)
}
function applyConsent(value: Consent | null) {
  consent = value
  consentListeners.forEach(listener => listener(value))
  if (value === 'granted') {
    if (currentScreen) trackScreen(currentScreen)
  } else if (initialized) {
    // Stop collection immediately, remove our host-only cookies, then unload the tag.
    ;(window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`] = true
    for (const item of document.cookie.split(';')) {
      const name = item.trim().split('=')[0]
      if (name === '_ga' || name === `_ga_${MEASUREMENT_ID.slice(2)}`) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
    }
    window.location.reload()
  }
}
