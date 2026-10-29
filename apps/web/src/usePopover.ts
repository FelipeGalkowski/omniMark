import { useEffect, useId, useRef } from 'react'

export function usePopover(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close.current() }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.contains(event.target as Node)) {
        event.preventDefault(); event.stopPropagation(); close.current()
        ref.current.querySelector('button')?.focus()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return { ref, id }
}
