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

  it('resets selection, filters and load errors on a new file', () => {
    let state = reducer(initialState, { type: 'loadFailed', message: 'nope' })
    state = reducer({ ...state, runIndex: 3, selectedId: 'x', filters: { hidden: ['log'], errorsOnly: true, text: 'q' } }, { type: 'loaded', name: 'x', text: '' })
    expect(state).toEqual({ ...initialState, file: { name: 'x', runs: [], issues: [] } })
  })

  it('closes back to the empty state', () => {
    const state = reducer(initialState, { type: 'loaded', name: 'x', text: '' })
    expect(reducer(state, { type: 'close' })).toEqual(initialState)
  })

  it('toggles a category on and off', () => {
    const once = reducer(initialState, { type: 'toggleCategory', category: 'tool' })
    expect(once.filters.hidden).toEqual(['tool'])
    expect(reducer(once, { type: 'toggleCategory', category: 'tool' }).filters.hidden).toEqual([])
  })

  it('opens detail for the selected item only when there is one', () => {
    expect(reducer(initialState, { type: 'openDetail' }).detailOpen).toBe(false)
    const open = reducer(initialState, { type: 'openDetail', id: 'e1' })
    expect(open).toMatchObject({ selectedId: 'e1', detailOpen: true })
    expect(reducer(open, { type: 'closeDetail' })).toMatchObject({ selectedId: 'e1', detailOpen: false })
  })

  it('collapses and expands step groups', () => {
    const collapsed = reducer(initialState, { type: 'setCollapsed', key: 'step-2', collapsed: true })
    expect(collapsed.collapsed).toEqual(['step-2'])
    expect(reducer(collapsed, { type: 'setCollapsed', key: 'step-2', collapsed: false }).collapsed).toEqual([])
  })

  it('clears selection when switching runs', () => {
    const state = reducer({ ...initialState, selectedId: 'x', detailOpen: true }, { type: 'selectRun', index: 1 })
    expect(state).toMatchObject({ runIndex: 1, selectedId: undefined, detailOpen: false })
  })
})
