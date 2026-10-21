import { describe, expect, it } from 'vitest'
import { at, ev, runsFrom } from '../../test/helpers.ts'
import { descendantsOf } from './nesting.ts'
import { groupItems } from '../../ui/timeline/groups.ts'
import { NO_FILTERS } from '../filter.ts'

const model = (id: string, step: number, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'model.call', id, step, ts: at(sec), provider: 'p', model: 'm', duration_ms: 500, status: 'ok', usage: { input_tokens: 10, output_tokens: 1 }, cost_usd: 0.01, ...fields })
const tool = (id: string, step: number, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'tool.call', id, step, ts: at(sec), tool: 't', duration_ms: 200, status: 'ok', ...fields })
const agent = (id: string, step: number, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'agent.call', id, step, ts: at(sec), agent: { name: 'explorer' }, duration_ms: 5000, status: 'ok', ...fields })

const lines = [
  model('m1', 1, 0),
  agent('a1', 1, 1),
  model('am1', 1, 1.1, { parent_id: 'a1' }),
  tool('at1', 1, 1.5, { parent_id: 'a1' }),
  agent('a2', 2, 2, { parent_id: 'a1', agent: { name: 'grep' } }),
  tool('aat1', 1, 2.1, { parent_id: 'a2' }),
  model('am2', 2, 3, { parent_id: 'a1' }),
  model('m2', 2, 7),
]

describe('nestItems', () => {
  it('lists each sub-agent event under the call that started it, depth first', () => {
    const [run] = runsFrom(lines)
    expect(run!.items.map((i) => [i.id, i.depth, i.parentItemId ?? null])).toEqual([
      ['m1', 0, null],
      ['a1', 0, null],
      ['am1', 1, 'a1'],
      ['at1', 1, 'a1'],
      ['a2', 1, 'a1'],
      ['aat1', 2, 'a2'],
      ['am2', 1, 'a1'],
      ['m2', 0, null],
    ])
    expect(run!.items.find((i) => i.id === 'a1')!.descendants).toBe(5)
    expect(descendantsOf(run!.items, 'a2').map((i) => i.id)).toEqual(['aat1'])
  })

  it("keeps nested events in their top-level ancestor's step, whatever step the sub-agent was on", () => {
    const [run] = runsFrom(lines)
    const groups = groupItems(run!.items, NO_FILTERS)
    expect(groups.map((g) => [g.step, g.items.map((i) => i.id)])).toEqual([
      [1, ['m1', 'a1', 'am1', 'at1', 'a2', 'aat1', 'am2']],
      [2, ['m2']],
    ])
  })

  it('hides everything under a folded row and counts it as folded, not filtered', () => {
    const [run] = runsFrom(lines)
    const [first] = groupItems(run!.items, NO_FILTERS, ['sub:a2'])
    expect(first!.items.map((i) => i.id)).toEqual(['m1', 'a1', 'am1', 'at1', 'a2', 'am2'])
    const [outer] = groupItems(run!.items, NO_FILTERS, ['sub:a1'])
    expect(outer!.items.map((i) => i.id)).toEqual(['m1', 'a1'])
    expect(outer!.folded).toBe(5)
  })

  it('leaves events whose parent is missing or circular at the top level', () => {
    const [run] = runsFrom([model('m1', 1, 0, { parent_id: 'nope' }), tool('x', 1, 1, { parent_id: 'y' }), tool('y', 1, 2, { parent_id: 'x' })])
    expect(run!.items.map((i) => i.depth)).toEqual([0, 0, 0])
  })

  it('still counts nested calls in the run totals', () => {
    const [run] = runsFrom(lines)
    expect(run!.totals).toMatchObject({ modelCalls: 4, toolCalls: 2 })
  })
})
