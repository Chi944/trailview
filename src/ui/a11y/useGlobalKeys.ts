import { useEffect } from 'react'

export type GlobalKeyHandlers = Partial<Record<string, () => void>>

// Single-key shortcuts that work anywhere except while typing in a field.
// Escape always works, so it can also leave a field.
export function useGlobalKeys(handlers: GlobalKeyHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (typing && e.key !== 'Escape') return
      const handler = handlers[e.key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handlers, enabled])
}
