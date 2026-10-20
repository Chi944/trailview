import { describe, expect, it } from 'vitest'
import sample from '../../test/schema-example.jsonl?raw'
import { parseJsonl } from '../../core/parse/jsonl.ts'
import { buildRuns } from '../../core/model/run.ts'
import { NO_FILTERS } from '../../core/filter.ts'
import { groupItems } from './groups.ts'
import { layoutEntries, scrollToReveal, visibleRange } from './window.ts'

const run = buildRuns(parseJsonl(sample).events)[0]!
const groups = groupItems(run.items, NO_FILTERS)

describe('layoutEntries', () => {
  it('puts a header before each group and stacks fixed heights', () => {
    const { entries, tops, indexById } = layoutEntries(groups, [], 30, 36)
    expect(entries.slice(0, 4).map((e) => (e.kind === 'header' ? `h:${e.group.key}` : e.item.id))).toEqual(['h:run', 'e01', 'h:step-1', 'e02'])
    expect(tops.slice(0, 5)).toEqual([0, 30, 66, 96, 132])
    expect(tops.at(-1)).toBe(6 * 30 + 12 * 36)
    expect(indexById.get('e02')).toBe(3)
  })

  it('keeps a collapsed group header and drops its rows', () => {
    const { entries } = layoutEntries(groups, ['step-1'], 30, 36)
    expect(entries.map((e) => (e.kind === 'header' ? e.group.key : e.item.id)).slice(2, 4)).toEqual(['step-1', 'step-2'])
  })
})

describe('visibleRange', () => {
  const tops = Array.from({ length: 1001 }, (_, i) => i * 10)

  it('covers the viewport plus overscan', () => {
    expect(visibleRange(tops, 0, 100, 5)).toEqual({ start: 0, end: 16 })
    expect(visibleRange(tops, 5000, 100, 5)).toEqual({ start: 495, end: 516 })
  })

  it('clamps at the end', () => {
    expect(visibleRange(tops, 9990, 100, 5)).toEqual({ start: 994, end: 1000 })
    expect(visibleRange([0], 0, 100)).toEqual({ start: 0, end: 0 })
  })
})

describe('scrollToReveal', () => {
  it('scrolls up or down only as far as needed', () => {
    expect(scrollToReveal(50, 86, 100, 300, 30)).toBe(20)
    expect(scrollToReveal(500, 536, 100, 300)).toBe(236)
    expect(scrollToReveal(200, 236, 100, 300, 30)).toBeUndefined()
  })
})
