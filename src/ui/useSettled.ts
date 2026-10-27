import { useEffect, useState } from 'react'

// `value`, once it has stopped changing for `delayMs`. With a delay of 0 it is
// `value` itself, with no extra render.
export function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (delayMs <= 0) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return delayMs > 0 ? settled : value
}
