import { describe, expect, it } from 'vitest'
import { focusLost } from './useFocusOnMount.ts'

const el = (isConnected: boolean) => ({ isConnected }) as Element
const body = el(true)

describe('focusLost', () => {
  it('is lost when nothing, or only the page, has focus', () => {
    expect(focusLost(null, body)).toBe(true)
    expect(focusLost(body, body)).toBe(true)
  })

  it('is lost when the focused element has left the page', () => {
    expect(focusLost(el(false), body)).toBe(true)
  })

  it('is kept on an element that is still on the page', () => {
    expect(focusLost(el(true), body)).toBe(false)
  })
})
