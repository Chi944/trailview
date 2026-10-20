import { describe, expect, it } from 'vitest'
import { at, ev, runsFrom } from '../../test/helpers.ts'
import { isUnfinished } from './starts.ts'

const runStart = ev({ type: 'run.start', id: 's', v: 1, agent: { name: 'a' } })
const modelStart = (id: string, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'model.start', id, step: 1, ts: at(sec), provider: 'p', model: 'm', ...fields })
const toolStart = (id: string, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'tool.start', id, step: 1, ts: at(sec), tool: 'fetch', ...fields })
const model = (id: string, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'model.call', id, step: 1, ts: at(sec), provider: 'p', model: 'm', duration_ms: 1000, status: 'ok', ...fields })
const tool = (id: string, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'tool.call', id, step: 1, ts: at(sec), tool: 'fetch', duration_ms: 500, status: 'ok', ...fields })

describe('start lines', () => {
  it('fold into the call that finishes them, by start_id or by tool call_id', () => {
    const [run] = runsFrom([
      runStart,
      modelStart('ms1', 1),
      model('m1', 1, { start_id: 'ms1' }),
      toolStart('ts1', 2, { call_id: 'c1' }),
      tool('t1', 2, { call_id: 'c1' }),
    ])
    expect(run!.events.map((e) => e.event.id)).toEqual(['s', 'm1', 't1'])
    expect(run!.totals.errors).toBe(0)
  })

  it('without a finished call become unfinished calls that last until the log ends', () => {
    const [run] = runsFrom([runStart, model('m1', 1), toolStart('ts1', 3, { input: { url: 'x' } }), ev({ type: 'log', id: 'l1', ts: at(9), message: 'still waiting' })])
    const unfinished = run!.events.find((e) => e.event.id === 'ts1')!
    expect(isUnfinished(unfinished)).toBe(true)
    expect(unfinished.event).toMatchObject({ type: 'tool.call', tool: 'fetch', status: 'error', duration_ms: 6000, input: { url: 'x' }, error: { type: 'unfinished' } })
    expect(unfinished.kind === 'known' && unfinished.source?.type).toBe('tool.start')
    expect(run!.status).toBe('incomplete')
    expect(run!.totals).toMatchObject({ toolCalls: 1, errors: 1 })
  })

  it('keep an unfinished model call in its retry chain', () => {
    const [run] = runsFrom([
      runStart,
      model('m1', 1, { status: 'error', error: { type: 'overloaded', message: 'busy' } }),
      modelStart('ms2', 3, { attempt: 2, retry_of: 'm1' }),
    ])
    const chain = run!.items.find((i) => i.id === 'm1')!
    expect(chain.events.map((e) => e.event.id)).toEqual(['m1', 'ms2'])
    expect(isUnfinished(chain.events[1]!)).toBe(true)
  })

  it('last zero time when nothing else is in the log', () => {
    const [run] = runsFrom([toolStart('ts1', 0)])
    expect(run!.events[0]!.event).toMatchObject({ type: 'tool.call', duration_ms: 0, unfinished: true })
  })
})
