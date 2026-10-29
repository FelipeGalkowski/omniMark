import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dialog from './Dialog'
import { StatusDropdown } from './ui'

it('contains focus, makes the background inert and restores focus after Escape', async () => {
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Abrir</button>{open && <Dialog label="Teste de diálogo" onClose={() => setOpen(false)}><button>Primeiro</button><button>Último</button></Dialog>}</>
  }
  const view = render(<Fixture />)
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name:'Abrir' })
  await user.click(trigger)
  const dialog = screen.getByRole('dialog', { name:'Teste de diálogo' })
  const first = within(dialog).getByRole('button', { name:'Primeiro' })
  const last = within(dialog).getByRole('button', { name:'Último' })
  expect(document.activeElement).toBe(first)
  expect(view.container.inert).toBe(true)
  await user.tab({ shift:true }); expect(document.activeElement).toBe(last)
  await user.tab(); expect(document.activeElement).toBe(first)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(view.container.inert).not.toBe(true)
})
it('does not dismiss a busy confirmation', async () => {
  const close = vi.fn()
  render(<Dialog label="Salvando" role="alertdialog" busy onClose={close}><button disabled>Salvar</button></Dialog>)
  await userEvent.setup().keyboard('{Escape}')
  expect(close).not.toHaveBeenCalled()
})
it('announces an empty filter and closes it with Escape', async () => {
  render(<StatusDropdown selected={[]} onToggle={() => {}} />)
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name:'Nenhuma situação selecionada' })
  await user.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name:'Pago' }).getAttribute('aria-pressed')).toBe('false')
  await user.tab(); await user.keyboard('{Escape}')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
})
