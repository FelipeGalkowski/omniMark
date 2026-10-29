import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

beforeEach(() => {
  vi.resetModules()
  document.getElementById('omnimark-google-analytics')?.remove()
  vi.stubGlobal('location', { hostname: 'teste.omnimark.tech', origin: 'https://teste.omnimark.tech', href: 'https://teste.omnimark.tech/?email=private#reset_token=secret', reload: vi.fn() })
  vi.stubGlobal('dataLayer', undefined)
  vi.stubGlobal('gtag', undefined)
})
it('does not load or send events before consent or after refusal', async () => {
  const analytics = await import('./analytics')
  analytics.trackScreen('login'); analytics.trackEvent('login')
  analytics.setAnalyticsConsent('denied'); analytics.trackScreen('accounts')
  expect(document.getElementById('omnimark-google-analytics')).toBeNull()
  expect(window.dataLayer).toBeUndefined()
})
it('loads once, measures current screen on acceptance and never includes the real URL', async () => {
  const analytics = await import('./analytics')
  analytics.trackScreen('login')
  analytics.setAnalyticsConsent('granted')
  analytics.trackScreen('login'); analytics.trackScreen('accounts'); analytics.trackEvent('marketplace_connect_start', 'shopee')
  expect(document.querySelectorAll('#omnimark-google-analytics')).toHaveLength(1)
  const commands = window.dataLayer!.map(item => Array.from(item as ArrayLike<unknown>))
  expect(commands.filter(item => item[1] === 'page_view')).toHaveLength(2)
  expect(commands).toContainEqual(['event', 'marketplace_connect_start', { marketplace: 'shopee' }])
  expect(JSON.stringify(commands)).not.toMatch(/private|secret|reset_token/)
  expect(commands).toContainEqual(['event', 'page_view', { page_location: 'https://teste.omnimark.tech/accounts', page_title: 'Contas', page_referrer: '' }])
})
it('restores consent and keeps local/other environments disabled', async () => {
  localStorage.setItem('omnimark_analytics_consent_v1', 'granted')
  vi.stubGlobal('location', { hostname: 'localhost', origin: 'http://localhost:5173' })
  const analytics = await import('./analytics')
  expect(analytics.readConsent()).toBe('granted')
  analytics.trackScreen('orders')
  expect(window.dataLayer).toBeUndefined()
})
it('revokes collection, removes analytics cookies and reloads without removing the session', async () => {
  const analytics = await import('./analytics')
  analytics.setAnalyticsConsent('granted'); analytics.trackScreen('orders')
  document.cookie = '_ga=test; Path=/'
  document.cookie = '_ga_9Y6DVJWVG3=test; Path=/'
  document.cookie = 'session=keep; Path=/'
  analytics.setAnalyticsConsent('denied')
  const count = window.dataLayer!.length
  analytics.trackScreen('accounts'); analytics.trackEvent('login')
  expect(window.dataLayer).toHaveLength(count)
  expect(document.cookie).not.toContain('_ga')
  expect(document.cookie).toContain('session=keep')
  expect(window.location.reload).toHaveBeenCalledOnce()
})
it('offers refusal, acceptance and a way to change the choice', async () => {
  const { default: Consent } = await import('./AnalyticsConsent')
  const user = userEvent.setup()
  render(<Consent />)
  await user.click(screen.getByRole('button', { name: 'Recusar' }))
  expect(localStorage.getItem('omnimark_analytics_consent_v1')).toBe('denied')
  await user.click(screen.getByRole('button', { name: 'Preferências de cookies' }))
  await user.click(screen.getByRole('button', { name: 'Aceitar Analytics' }))
  expect(localStorage.getItem('omnimark_analytics_consent_v1')).toBe('granted')
}, 15000)
it('stops all collection in an already open tab when another tab revokes consent', async () => {
  const analytics = await import('./analytics')
  analytics.setAnalyticsConsent('granted'); analytics.trackScreen('orders')
  const listener = vi.fn()
  const unsubscribe = analytics.subscribeAnalyticsConsent(listener)
  document.cookie = '_ga=test; Path=/'
  localStorage.setItem(analytics.CONSENT_KEY, 'denied')
  window.dispatchEvent(new StorageEvent('storage', { key:analytics.CONSENT_KEY, newValue:'denied' }))
  const count = window.dataLayer!.length
  analytics.trackEvent('login'); analytics.trackScreen('accounts')
  expect(window.dataLayer).toHaveLength(count)
  expect(document.cookie).not.toContain('_ga')
  expect(listener).toHaveBeenCalledWith('denied')
  expect(window.location.reload).toHaveBeenCalledOnce()
  unsubscribe()
})
it('rechecks persisted consent before sending even when the storage event is delayed', async () => {
  const analytics = await import('./analytics')
  analytics.setAnalyticsConsent('granted'); analytics.trackScreen('orders')
  localStorage.removeItem(analytics.CONSENT_KEY)
  const count = window.dataLayer!.length
  analytics.trackEvent('login')
  expect(window.dataLayer).toHaveLength(count)
  expect(window.location.reload).toHaveBeenCalledOnce()
})
