import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
const layers: HTMLElement[] = []
const inertBefore = new Map<HTMLElement, boolean>()
let overflowBefore = ''

function isolateDialogs() {
  const top = layers.at(-1)
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (!inertBefore.has(child)) inertBefore.set(child, child.inert)
    child.inert = top ? child !== top : inertBefore.get(child)!
  }
  if (!top) { inertBefore.forEach((value, node) => { node.inert = value }); inertBefore.clear() }
}

export default function Dialog({ children, label, describedBy, onClose, style, panel = false, role = 'dialog', busy = false }: {
  children: ReactNode; label: string; onClose: () => void; style?: CSSProperties
  describedBy?: string
  panel?: boolean; role?: 'dialog' | 'alertdialog'; busy?: boolean
}) {
  const layer = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const active = document.activeElement as HTMLElement | null
  const previous = useRef(active?.closest('[data-popover]')?.querySelector<HTMLElement>('button') ?? active)
  const close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const root = layer.current!, content = dialog.current!
    if (!layers.length) { overflowBefore = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    layers.push(root); isolateDialogs()
    const focusFirst = () => (content.querySelector<HTMLElement>('[data-autofocus]') ?? content.querySelector<HTMLElement>('input:not(:disabled)') ?? content.querySelector<HTMLElement>(focusable) ?? content).focus()
    focusFirst()
    const containFocus = (event: FocusEvent) => {
      if (layers.at(-1) === root && !content.contains(event.target as Node)) focusFirst()
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      layers.splice(layers.indexOf(root), 1); isolateDialogs()
      if (!layers.length) document.body.style.overflow = overflowBefore
      if (previous.current?.isConnected) previous.current.focus()
    }
  }, [])
  return createPortal(<div ref={layer} className={`dialog-layer${panel ? ' dialog-layer--panel' : ''}`}
    onClick={event => { if (event.target === event.currentTarget && !busy) close.current() }}>
    <div ref={dialog} role={role} aria-modal="true" aria-label={label} aria-describedby={describedBy} aria-busy={busy} tabIndex={-1}
      className={panel ? 'dialog-panel' : 'dialog-card'} style={style}
      onKeyDown={event => {
        if (layers.at(-1) !== layer.current) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) close.current() }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>(focusable)).filter(node => !node.hidden && !node.closest('[hidden], [inert]'))
          const first = controls[0], last = controls.at(-1)
          if (!first) { event.preventDefault(); dialog.current!.focus() }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last!.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
        }
      }}>{children}</div>
  </div>, document.body)
}
