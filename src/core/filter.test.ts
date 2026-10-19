import { describe, expect, it } from 'vitest'
import sample from '../../samples/oncall-digest.jsonl?raw'
import { parseJsonl } from './parse/jsonl.ts'
import { buildRuns } from './model/run.ts'
import { NO_FILTERS, matchesFilters, type Filters } from './filter.ts'

const run = buildRuns(parseJsonl(sample).events)[0]!
const visible = (filters: Partial<Filters>) =>
  run.items.filter((i) => matchesFilters(i, { ...NO_FILTERS, ...filters })).map((i) => i.id)

describe('matchesFilters', () => {
  it('shows everything with no filters', () => {
    expect(visible({})).toHaveLength(run.items.length)
  })

  it('hides whole categories', () => {
    expect(visible({ hidden: ['model', 'approval', 'run'] })).toEqual(['e03', 'e11'])
  })

  it('keeps a retry chain under errors only when any attempt failed', () => {
    expect(visible({ errorsOnly: true })).toEqual(['e03'])
  })

  it('searches event content case-insensitively', () => {
    expect(visible({ text: 'ONCALL@example' })).toEqual(['e08', 'e09', 'e11'])
  })

  it('combines filters', () => {
    expect(visible({ text: 'oncall@example', hidden: ['approval'] })).toEqual(['e08', 'e11'])
  })
})
