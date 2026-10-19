import { describe, expect, it } from 'vitest'
import sample from '../../../samples/oncall-digest.jsonl?raw'
import { parseJsonl } from '../parse/jsonl.ts'
import { buildRuns } from './run.ts'
import { at, ev, runsFrom } from '../../test/helpers.ts'

const start = ev({ type: 'run.start', id: 's', v: 1, agent: { name: 'agent' } })
const model = (fields: Record<string, unknown>) =>
  ev({ type: 'model.call', provider: 'p', model: 'm', duration_ms: 100, status: 'ok', ...fields })
const tool = (fields: Record<string, unknown>) =>
  ev({ type: 'tool.call', tool: 't', duration_ms: 100, status: 'ok', ...fields })

describe('buildRuns on the on-call sample', () => {
  const [run] = buildRuns(parseJsonl(sample).events)

  it('matches the derived values documented in docs/schema.md', () => {
    expect(run).toBeDefined()
    expect(run!.status).toBe('succeeded')
    expect(run!.agent).toEqual({ name: 'oncall-digest', version: '0.4.2' })
    expect(run!.totals).toMatchObject({
      wallMs: 151_030,
      waitMs: 123_810,
      modelCalls: 4,
      toolCalls: 3,
      retries: 1,
      inputTokens: 16_570,
      outputTokens: 1_028,
      approvals: 2,
      rejections: 1,
      errors: 1,
      costEstimated: false,
      unpricedCalls: 0,
    })
    expect(run!.totals.costUsd).toBeCloseTo(0.0651, 6)
  })

  it('folds the retried lookup into one timeline item', () => {
    const chain = run!.items.find((i) => i.events.length > 1)
    expect(chain?.events.map((e) => e.event.id)).toEqual(['e03', 'e04'])
    expect(run!.items).toHaveLength(12)
  })

  it('pairs approvals with their decisions and tool calls', () => {
    expect(run!.approvals.map((a) => [a.approvalId, a.outcome, a.waitMs, a.toolCall?.id])).toEqual([
      ['ap_1', 'rejected', 101_360, undefined],
      ['ap_2', 'approved', 22_450, 'e11'],
    ])
  })
})

describe('buildRuns', () => {
  it('splits a file into runs in order of first appearance', () => {
    const runs = runsFrom([start, ev({ type: 'log', id: 'x', run_id: 'r2', message: 'm' }), ev({ type: 'log', id: 'y', message: 'm' })])
    expect(runs.map((r) => [r.id, r.events.length])).toEqual([
      ['r1', 2],
      ['r2', 1],
    ])
  })

  it('marks a run without run.end as incomplete', () => {
    expect(runsFrom([start]).at(0)?.status).toBe('incomplete')
  })

  it('takes status, output and error from run.end', () => {
    const end = ev({ type: 'run.end', id: 'end', status: 'failed', error: { type: 'crash', message: 'boom' } })
    expect(runsFrom([start, end])[0]).toMatchObject({ status: 'failed', error: { message: 'boom' } })
  })

  it('orders events by timestamp, then by file line', () => {
    const run = runsFrom([
      ev({ type: 'log', id: 'late', ts: at(5), message: 'm' }),
      ev({ type: 'log', id: 'a', ts: at(1), message: 'm' }),
      ev({ type: 'log', id: 'b', ts: at(1), message: 'm' }),
    ])[0]
    expect(run!.events.map((e) => e.event.id)).toEqual(['a', 'b', 'late'])
  })

  it('measures wall time to the end of the last call', () => {
    const run = runsFrom([start, model({ id: 'm1', ts: at(2), duration_ms: 3000 })])[0]
    expect(run!.totals.wallMs).toBe(5000)
  })

  it('keeps unknown event types on the timeline', () => {
    const run = runsFrom([start, ev({ type: 'custom', id: 'c' })])[0]
    expect(run!.items.map((i) => i.id)).toEqual(['s', 'c'])
  })
})

describe('retry folding', () => {
  it('chains several attempts and counts each extra attempt', () => {
    const run = runsFrom([
      tool({ id: 't1', status: 'error', attempt: 1, error: { type: 'x', message: 'x' } }),
      tool({ id: 't2', ts: at(1), status: 'error', attempt: 2, retry_of: 't1', error: { type: 'x', message: 'x' } }),
      tool({ id: 't3', ts: at(2), attempt: 3, retry_of: 't2' }),
    ])[0]!
    expect(run.items).toHaveLength(1)
    expect(run.items[0]!.events.map((e) => e.event.id)).toEqual(['t1', 't2', 't3'])
    expect(run.totals).toMatchObject({ toolCalls: 3, retries: 2, errors: 2 })
  })

  it('leaves a call whose retry_of points nowhere as its own row', () => {
    const run = runsFrom([tool({ id: 't2', retry_of: 'missing' })])[0]!
    expect(run.items.map((i) => i.id)).toEqual(['t2'])
  })
})

describe('approvals', () => {
  it('reports a request with no decision as pending', () => {
    const run = runsFrom([ev({ type: 'approval.request', id: 'q', approval_id: 'a1', action: 'x', summary: 's' })])[0]!
    expect(run.approvals).toHaveLength(1)
    expect(run.approvals[0]).toMatchObject({ approvalId: 'a1', outcome: 'pending' })
    expect(run.approvals[0]?.waitMs).toBeUndefined()
    expect(run.totals).toMatchObject({ approvals: 1, rejections: 0, waitMs: 0 })
  })
})

describe('cost', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000 }

  it('uses cost_usd from the log when present', () => {
    const run = runsFrom([model({ id: 'm', model: 'claude-sonnet-4', usage, cost_usd: 1.23 })])[0]!
    expect(run.totals).toMatchObject({ costUsd: 1.23, costEstimated: false })
  })

  it('estimates from the bundled table, matching dated model ids by prefix', () => {
    const run = runsFrom([model({ id: 'm', model: 'claude-sonnet-4-20250514', usage })])[0]!
    expect(run.totals.costUsd).toBeCloseTo(3 + 1.5, 9)
    expect(run.totals.costEstimated).toBe(true)
  })

  it('prefers run.start pricing over the bundled table', () => {
    const custom = ev({ type: 'run.start', id: 's', v: 1, agent: { name: 'a' }, pricing: { 'claude-sonnet-4': { input_per_mtok: 1, output_per_mtok: 2 } } })
    const run = runsFrom([custom, model({ id: 'm', model: 'claude-sonnet-4', usage })])[0]!
    expect(run.totals.costUsd).toBeCloseTo(1 + 0.2, 9)
  })

  it('counts calls it cannot price instead of guessing', () => {
    const run = runsFrom([model({ id: 'm', model: 'mystery-model', usage })])[0]!
    expect(run.totals).toMatchObject({ costUsd: 0, costEstimated: false, unpricedCalls: 1 })
  })

  it('sums cache tokens separately', () => {
    const run = runsFrom([model({ id: 'm', cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 5, cache_write_tokens: 7 } })])[0]!
    expect(run.totals).toMatchObject({ cacheReadTokens: 5, cacheWriteTokens: 7 })
  })
})
