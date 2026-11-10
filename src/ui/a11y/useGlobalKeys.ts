import { useEffect, useLayoutEffect, useRef } from 'react'

export type GlobalKeyHandlers = Partial<Record<string, () => void>>

interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  target: EventTarget | null
}

// The handler for a key press, if any. Single keys work anywhere except while
// typing in a field; Escape always works, so it can also leave a field.
export function handlerFor(e: KeyLike, handlers: GlobalKeyHandlers | undefined): (() => void) | undefined {
  if (!handlers || e.metaKey || e.ctrlKey || e.altKey) return undefined
  const target = e.target as HTMLElement | null
  const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  if (typing && e.key !== 'Escape') return undefined
  return handlers[e.key]
}

// The listener is attached once, and the handlers it calls are swapped in as
// the screen commits, not after paint. Otherwise a key pressed just after a
// render (say, right after a log opens) runs the previous render's handlers,
// or none at all.
export function useGlobalKeys(handlers: GlobalKeyHandlers, enabled = true) {
  const current = useRef<GlobalKeyHandlers | undefined>(undefined)
  useLayoutEffect(() => {
    current.current = enabled ? handlers : undefined
  }, [handlers, enabled])
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const handler = handlerFor(e, current.current)
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      current.current = undefined
    }
  }, [])
}
