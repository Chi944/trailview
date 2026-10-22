import { describe, expect, it } from 'vitest'
import subagents from '../../../samples/dev-lead-subagents.jsonl?raw'
import { parseLog } from '../parse/detect.ts'
import { buildRuns } from '../model/run.ts'
import { at, ev, runsFrom } from '../../test/helpers.ts'
import { costByAgent, costByModel } from './breakdown.ts'

const call = (id: string, s: number, model: string, extra: Record<string, unknown> = {}) =>
  ev({ type: 'model.call', id, ts: at(s), provider: 'p', model, duration_ms: 10, status: 'ok', usage: { input_tokens: 100, output_tokens: 10 }, ...extra })

describe('costByModel', () => {
  it('groups calls by model, counts every attempt and sorts by cost', () => {
    const [run] = runsFrom([
      call('a', 1, 'small', { cost_usd: 0.01 }),
      call('b', 2, 'big', { cost_usd: 0.5, status: 'error' }),
      call('c', 3, 'big', { cost_usd: 0.5, retry_of: 'b', attempt: 2 }),
      call('d', 4, 'mystery'),
    ])
    const rows = costByModel(run!.items, run!.pricing)
    expect(rows.map((r) => [r.label, r.modelCalls, r.costUsd, r.inputTokens, r.unpriced])).toEqual([
      ['big', 2, 1, 200, 0],
      ['small', 1, 0.01, 100, 0],
      ['mystery', 1, 0, 100, 1],
    ])
  })

  it('marks a model whose cost is estimated from prices', () => {
    const [run] = runsFrom([ev({ type: 'run.start', id: 's', v: 1, agent: { name: 'x' }, pricing: { m: { input_per_mtok: 1, output_per_mtok: 1 } } }), call('a', 1, 'm')])
    const [row] = costByModel(run!.items, run!.pricing)
    expect(row).toMatchObject({ label: 'm', estimated: true, costUsd: 110 / 1e6 })
  })
})

describe('costByAgent', () => {
  it('returns nothing for a run without sub-agents', () => {
    const [run] = runsFrom([call('a', 1, 'm', { cost_usd: 1 })])
    expect(costByAgent(run!.items)).toEqual([])
  })

  it('counts each call under the nearest sub-agent and rolls totals up', () => {
    const [run] = runsFrom([
      call('m1', 1, 'm', { cost_usd: 1 }),
      ev({ type: 'agent.call', id: 'A', ts: at(2), agent: { name: 'outer' }, duration_ms: 10, status: 'ok' }),
      call('m2', 3, 'm', { cost_usd: 2, parent_id: 'A' }),
      ev({ type: 'agent.call', id: 'B', ts: at(4), parent_id: 'A', agent: { name: 'inner' }, duration_ms: 10, status: 'ok' }),
      ev({ type: 'tool.call', id: 't', ts: at(5), parent_id: 'B', tool: 'x', duration_ms: 1, status: 'ok' }),
      call('m3', 6, 'm', { cost_usd: 4, parent_id: 't' }),
      call('m4', 7, 'm', { cost_usd: 8 }),
    ])
    const rows = costByAgent(run!.items, run!.pricing, 'lead')
    expect(rows.map((r) => [r.label, r.depth, r.modelCalls, r.costUsd, r.totalUsd])).toEqual([
      ['lead', 0, 2, 9, 15],
      ['outer', 1, 1, 2, 6],
      ['inner', 2, 1, 4, 4],
    ])
  })

  it('adds up to the run total on the sub-agent sample', () => {
    const [run] = buildRuns(parseLog(subagents).events)
    const rows = costByAgent(run!.items, run!.pricing)
    expect(rows.map((r) => r.label)).toEqual(['Main agent', 'explorer', 'code-search', 'test-runner'])
    expect(rows.reduce((n, r) => n + r.modelCalls, 0)).toBe(run!.totals.modelCalls)
    expect(rows[0]!.totalUsd).toBeCloseTo(run!.totals.costUsd, 10)
    const models = costByModel(run!.items, run!.pricing)
    expect(models.reduce((n, r) => n + r.costUsd, 0)).toBeCloseTo(run!.totals.costUsd, 10)
  })
})
