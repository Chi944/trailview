import { describe, expect, it } from 'vitest'
import { linkHash, parseLink } from './link.ts'
import { initialState, reducer } from './state.ts'
import { ev } from '../test/helpers.ts'

describe('links', () => {
  it('round-trips a target through the hash, escaping names', () => {
    const target = { file: 'my run & co.jsonl', run: 'r1', event: 'e/2' }
    expect(parseLink(linkHash(target))).toEqual(target)
    expect(parseLink('#/?sample=a.jsonl')).toEqual({ sample: 'a.jsonl' })
  })

  it('reads nothing from an empty or unrelated hash', () => {
    expect(parseLink('')).toBeUndefined()
    expect(parseLink('#top')).toBeUndefined()
    expect(linkHash({})).toBe('')
  })
})

describe('opening a link', () => {
  const text = [
    ev({ type: 'log', id: 'a', message: 'm' }),
    ev({ type: 'log', id: 'b', run_id: 'r2', step: 1, message: 'm' }),
    ev({ type: 'log', id: 'c', run_id: 'r2', step: 2, message: 'm' }),
  ].join('\n')

  it('waits for the file, then opens the run and event with filters and folds cleared', () => {
    const waiting = reducer(initialState, { type: 'linkOpened', target: { file: 'x.jsonl', run: 'r2', event: 'c' } })
    expect(waiting.target).toEqual({ file: 'x.jsonl', run: 'r2', event: 'c' })
    const state = reducer({ ...waiting, collapsed: ['step:2'] }, { type: 'loaded', name: 'x.jsonl', text })
    expect(state).toMatchObject({ runIndex: 1, selectedId: 'c', detailOpen: true, collapsed: [], target: undefined, linkMiss: undefined })
  })

  it('applies a link to the file already open', () => {
    const loaded = reducer({ ...initialState, filters: { hidden: ['log'], errorsOnly: true, text: 'q' } }, { type: 'loaded', name: 'x', text })
    const state = reducer(loaded, { type: 'linkOpened', target: { run: 'r2', event: 'b' } })
    expect(state).toMatchObject({ runIndex: 1, selectedId: 'b', detailOpen: true, filters: initialState.filters })
  })

  it('says what is missing when the file lacks the run or the event', () => {
    const loaded = reducer(initialState, { type: 'loaded', name: 'x', text })
    expect(reducer(loaded, { type: 'linkOpened', target: { run: 'nope' } }).linkMiss).toBe('The link points to run nope, which is not in x.')
    const missing = reducer(loaded, { type: 'linkOpened', target: { run: 'r2', event: 'zz' } })
    expect(missing).toMatchObject({ runIndex: 1, detailOpen: false, linkMiss: 'The link points to event zz, which is not in run r2.' })
  })

  it('marks bundled samples so their links can reopen them', () => {
    expect(reducer(initialState, { type: 'loaded', name: 's.jsonl', text, sample: true }).file?.sample).toBe(true)
  })
})
