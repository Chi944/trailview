import { describe, expect, it } from 'vitest'
import sample from '../../test/schema-example.jsonl?raw'
import { parseJsonl } from '../../core/parse/jsonl.ts'
import { buildRuns } from '../../core/model/run.ts'
import { NO_FILTERS } from '../../core/filter.ts'
import { groupItems, moveSelection, visibleIds } from './groups.ts'

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
