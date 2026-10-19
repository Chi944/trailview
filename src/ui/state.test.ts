import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './state.ts'
import { ev } from '../test/helpers.ts'

describe('reducer', () => {
  it('parses a loaded file into runs and issues', () => {
    const text = [ev({ type: 'log', id: 'a', message: 'm' }), 'not json', ev({ type: 'log', id: 'b', run_id: 'r2', message: 'm' })].join('\n')
    const state = reducer(initialState, { type: 'loaded', name: 'run.jsonl', text })
    expect(state.file?.name).toBe('run.jsonl')
    expect(state.file?.runs.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(state.file?.issues).toHaveLength(1)
  })

  it('resets the selected run and any earlier load error on a new file', () => {
    let state = reducer(initialState, { type: 'loadFailed', message: 'nope' })
    state = reducer({ ...state, runIndex: 3 }, { type: 'loaded', name: 'x', text: '' })
    expect(state).toEqual({ file: { name: 'x', runs: [], issues: [] }, runIndex: 0 })
  })

  it('closes back to the empty state', () => {
    const state = reducer(initialState, { type: 'loaded', name: 'x', text: '' })
    expect(reducer(state, { type: 'close' })).toEqual(initialState)
  })
})
