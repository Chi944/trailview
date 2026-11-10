import { describe, expect, it } from 'vitest'
import { handlerFor } from './useGlobalKeys.ts'

const a = () => {}
const esc = () => {}
const handlers = { a, Escape: esc }
const press = (key: string, target: unknown = null, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, target: target as EventTarget | null, ...mods })

describe('handlerFor', () => {
  it('finds the handler for a plain key press', () => {
    expect(handlerFor(press('a'), handlers)).toBe(a)
    expect(handlerFor(press('b'), handlers)).toBeUndefined()
  })

  it('does nothing while the shortcuts are off', () => {
    expect(handlerFor(press('a'), undefined)).toBeUndefined()
  })

  it('leaves modified key presses to the browser', () => {
    expect(handlerFor(press('a', null, { ctrlKey: true }), handlers)).toBeUndefined()
    expect(handlerFor(press('a', null, { metaKey: true }), handlers)).toBeUndefined()
    expect(handlerFor(press('a', null, { altKey: true }), handlers)).toBeUndefined()
  })

  it('lets a person type in a field, but Escape still works there', () => {
    const input = { tagName: 'INPUT', isContentEditable: false }
    const editable = { tagName: 'DIV', isContentEditable: true }
    expect(handlerFor(press('a', input), handlers)).toBeUndefined()
    expect(handlerFor(press('a', editable), handlers)).toBeUndefined()
    expect(handlerFor(press('Escape', input), handlers)).toBe(esc)
  })
})
