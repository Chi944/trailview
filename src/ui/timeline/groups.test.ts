import { describe, expect, it } from 'vitest'
import sample from '../../test/schema-example.jsonl?raw'
import { parseJsonl } from '../../core/parse/jsonl.ts'
import { buildRuns } from '../../core/model/run.ts'
import { NO_FILTERS } from '../../core/filter.ts'
import { groupItems, hitIds, moveSelection, stepHit, visibleIds } from './groups.ts'
import { at, ev, runsFrom } from '../../test/helpers.ts'

const run = buildRuns(parseJsonl(sample).events)[0]!
const groups = groupItems(run.items, NO_FILTERS)

describe('groupItems', () => {
  it('groups consecutive items by step, with run start and end on their own', () => {
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ['run', ['e01']],
      ['step-1', ['e02', 'e03']],
      ['step-2', ['e05', 'e06', 'e07']],
      ['step-3', ['e08', 'e09', 'e10', 'e11']],
      ['step-4', ['e12']],
      ['run-1', ['e13']],
    ])
  })

  it('sums tokens and errors per step, and spans retries', () => {
    const step1 = groups[1]!
    expect(step1).toMatchObject({ inputTokens: 1820, outputTokens: 96, errors: 1, total: 2 })
    expect(step1.endMs - step1.startMs).toBe(14_020)
  })

  it('keeps group keys and totals when filters hide items', () => {
    const filtered = groupItems(run.items, { ...NO_FILTERS, errorsOnly: true })
    expect(filtered.map((g) => g.key)).toEqual(groups.map((g) => g.key))
    expect(filtered[1]).toMatchObject({ total: 2, items: [expect.objectContaining({ id: 'e03' })] })
  })
})

describe('moveSelection', () => {
  it('starts at the first or last row when nothing is selected', () => {
    expect(moveSelection(groups, [], undefined, 1)).toBe('e01')
    expect(moveSelection(groups, [], undefined, -1)).toBe('e13')
  })

  it('moves and stops at the ends', () => {
    expect(moveSelection(groups, [], 'e03', 1)).toBe('e05')
    expect(moveSelection(groups, [], 'e13', 1)).toBe('e13')
    expect(moveSelection(groups, [], 'e01', -1)).toBe('e01')
  })

  it('skips collapsed groups', () => {
    expect(visibleIds(groups, ['step-2'])).not.toContain('e06')
    expect(moveSelection(groups, ['step-2'], 'e03', 1)).toBe('e08')
  })

  it('continues from a selection that was just collapsed away', () => {
    expect(moveSelection(groups, ['step-2'], 'e06', 1)).toBe('e08')
    expect(moveSelection(groups, ['step-2'], 'e06', -1)).toBe('e03')
  })
})

describe('searching nested work', () => {
  const [nested] = runsFrom([
    ev({ type: 'agent.call', id: 'A', ts: at(1), step: 1, agent: { name: 'outer' }, duration_ms: 10, status: 'ok' }),
    ev({ type: 'agent.call', id: 'B', ts: at(2), parent_id: 'A', agent: { name: 'inner' }, duration_ms: 5, status: 'ok' }),
    ev({ type: 'log', id: 'L1', ts: at(3), parent_id: 'B', message: 'needle here' }),
    ev({ type: 'log', id: 'L2', ts: at(4), step: 2, message: 'hay' }),
    ev({ type: 'log', id: 'L3', ts: at(5), step: 3, message: 'another needle' }),
  ])
  const search = (text: string, extra: Partial<typeof NO_FILTERS> = {}) => groupItems(nested!.items, { ...NO_FILTERS, ...extra, text })

  it('keeps the sub-agent rows above a match as context', () => {
    const found = search('needle')
    expect(found.flatMap((g) => g.items.map((i) => i.id))).toEqual(['A', 'B', 'L1', 'L3'])
    expect([...found[0]!.context]).toEqual(['A', 'B'])
    expect(hitIds(found)).toEqual(['L1', 'L3'])
  })

  it('adds no context rows without a search, or when their category is hidden', () => {
    expect(groupItems(nested!.items, { ...NO_FILTERS, errorsOnly: true }).every((g) => g.context.size === 0)).toBe(true)
    expect(search('needle', { hidden: ['agent'] }).flatMap((g) => g.items.map((i) => i.id))).toEqual(['L1', 'L3'])
  })

  it('does not mark an ancestor that matches itself', () => {
    expect([...search('inner')[0]!.context]).toEqual(['A'])
  })
})

describe('stepHit', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const hits = ['b', 'd']

  it('moves to the next or previous hit and wraps around', () => {
    expect(stepHit(order, hits, undefined, 1)).toBe('b')
    expect(stepHit(order, hits, undefined, -1)).toBe('d')
    expect(stepHit(order, hits, 'b', 1)).toBe('d')
    expect(stepHit(order, hits, 'd', 1)).toBe('b')
    expect(stepHit(order, hits, 'b', -1)).toBe('d')
  })

  it('starts from a selection that is not a hit', () => {
    expect(stepHit(order, hits, 'c', 1)).toBe('d')
    expect(stepHit(order, hits, 'c', -1)).toBe('b')
    expect(stepHit(order, hits, 'gone', 1)).toBe('b')
  })

  it('returns nothing without hits', () => {
    expect(stepHit(order, [], 'a', 1)).toBeUndefined()
  })
})
