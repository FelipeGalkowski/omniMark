import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AuthContext } from './auth'
import { DEMO_NOW, initialDateRange } from './data'
import { DateRangePicker } from './ui'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 12))
})
afterEach(() => vi.useRealTimers())

function openPicker() {
  const onChange = vi.fn()
  const view = render(
    <AuthContext.Provider value={{ user: { id: 'real', name: 'Pessoa', email: 'test@example.invalid', isDemoUser: false }, updateUser: async () => {} }}>
      <DateRangePicker value={initialDateRange(false)} onChange={onChange} />
    </AuthContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar período' }))
  return { ...view, onChange }
}

describe('Limite de datas do filtro', () => {
  it('inicia o período real no primeiro dia do mês e termina hoje', () => {
    expect(initialDateRange(false)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 21) })
    expect(initialDateRange(true).to).toEqual(new Date(DEMO_NOW.getFullYear(), DEMO_NOW.getMonth(), DEMO_NOW.getDate()))
  })

  it('bloqueia dias futuros nos dois calendários e permite aplicar até hoje', () => {
    const { container, onChange } = openPicker()
    const tomorrow = container.querySelectorAll<HTMLButtonElement>('td[data-day="2026-10-22"] button')
    const today = container.querySelectorAll<HTMLButtonElement>('td[data-day="2026-10-21"] button')
    expect(tomorrow.length).toBe(2)
    expect(today.length).toBe(2)
    for (const button of tomorrow) {
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
    }
    for (const button of today) expect(button.disabled).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(onChange).toHaveBeenCalledWith({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 21) })
  })

  it.each([
    ['Este mês', new Date(2026, 9, 1), new Date(2026, 9, 21)],
    ['Mês passado', new Date(2026, 8, 1), new Date(2026, 8, 30)],
    ['Últimos 30 dias', new Date(2026, 8, 22), new Date(2026, 9, 21)],
  ])('mantém o atalho %s dentro do limite', (label, from, to) => {
    const { onChange } = openPicker()
    fireEvent.click(screen.getByRole('button', { name: label as string }))
    expect(onChange).toHaveBeenCalledWith({ from, to })
  })
})
