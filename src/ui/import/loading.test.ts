import { describe, expect, it } from 'vitest'
import { loadLog } from '../../core/load.ts'
import { initialState, reducer, type AppState } from '../state.ts'
import { ev } from '../../test/helpers.ts'

const TEXT = ev({ type: 'log', id: 'a', message: 'm' })
const loading = { name: 'big.jsonl', bytes: 150_000_000, side: 'main' } as const

describe('loading a file in the background', () => {
  it('shows the file being read and clears an earlier error', () => {
    const failed = reducer(initialState, { type: 'loadFailed', message: 'nope' })
    const state = reducer(failed, { type: 'loadStarted', loading })
    expect(state.loading).toEqual(loading)
    expect(state.loadError).toBeUndefined()
  })

  it('opens a file the worker already parsed, the same as one parsed from text', () => {
    const started = reducer(initialState, { type: 'loadStarted', loading })
    const fromWorker = reducer(started, { type: 'loaded', name: 'big.jsonl', parsed: loadLog(TEXT) })
    expect(fromWorker).toEqual(reducer(initialState, { type: 'loaded', name: 'big.jsonl', text: TEXT }))
    expect(fromWorker.loading).toBeUndefined()
  })

  it('stops showing progress when the parse fails or is cancelled', () => {
    const started = reducer(initialState, { type: 'loadStarted', loading })
    const failed = reducer(started, { type: 'loadFailed', message: 'Could not read big.jsonl: Out of memory' })
    expect(failed.loading).toBeUndefined()
    expect(failed.loadError).toMatch(/Out of memory/)
    expect(reducer(started, { type: 'loadCancelled' }).loading).toBeUndefined()
  })

  it('drops a comparison file still loading when compare mode closes', () => {
    const viewing = reducer(initialState, { type: 'loaded', name: 'a.jsonl', text: TEXT })
    const comparing: AppState = reducer(reducer(viewing, { type: 'startCompare' }), { type: 'loadStarted', loading: { ...loading, side: 'compare' } })
    expect(comparing.loading?.side).toBe('compare')
    expect(reducer(comparing, { type: 'stopCompare' }).loading).toBeUndefined()
  })

  it('opens a parsed comparison file', () => {
    const viewing = reducer(reducer(initialState, { type: 'loaded', name: 'a.jsonl', text: TEXT }), { type: 'startCompare' })
    const started = reducer(viewing, { type: 'loadStarted', loading: { ...loading, side: 'compare' } })
    const state = reducer(started, { type: 'compareLoaded', name: 'b.jsonl', parsed: loadLog(TEXT) })
    expect(state.compare?.name).toBe('b.jsonl')
    expect(state.loading).toBeUndefined()
  })
})
