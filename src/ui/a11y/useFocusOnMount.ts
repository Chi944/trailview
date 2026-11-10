import { useEffect, type RefObject } from 'react'

// Whether focus was lost: on nothing, or on an element that has left the page,
// as when the button that opened a view is replaced by the view.
export function focusLost(active: Element | null, body: Element | null): boolean {
  return !active || active === body || !active.isConnected
}

// When a view replaces the control that opened it, the browser drops focus to
// the page. This puts it on the view instead (usually its heading), so a
// keyboard user carries on from there. It leaves focus alone if it is still
// somewhere useful.
export function useFocusOnMount(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (focusLost(document.activeElement, document.body)) ref.current?.focus({ preventScroll: true })
  }, [ref])
}
