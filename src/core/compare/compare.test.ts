import { describe, expect, it } from 'vitest'
import { at, ev, runsFrom } from '../../test/helpers.ts'
import { compareRuns, summarizeSteps } from './compare.ts'

const model = (id: string, step: number, sec: number, fields: Record<string, unknown> = {}) =>
  ev({ type: 'model.call', id, step, ts: at(sec), provider: 'p', model: 'm', duration_ms: 1000, status: 'ok', usage: { input_tokens: 100, output_tokens: 10 }, cost_usd: 0.01, ...fields })
const tool = (id: string, step: number, sec: number, name: string, fields: Record<string, unknown> = {}) =>
  ev({ type: 'tool.call', id, step, ts: at(sec), tool: name, duration_ms: 500, status: 'ok', ...fields })

describe('summarizeSteps', () => {
  it('sums tokens, cost and errors per step and lists tools once per retry chain', () => {
    const [run] = runsFrom([
      model('m1', 1, 0),
      tool('t1', 1, 1, 'fetch', { status: 'error', error: { type: 'timeout', message: 'slow' } }),
      tool('t2', 1, 2, 'fetch', { attempt: 2, retry_of: 't1' }),
      model('m2', 2, 3, { cost_usd: 0.02 }),
    ])
    const [one, two] = summarizeSteps(run!)
    expect(one).toEqual({
      step: 1,
      models: ['m'],
      tools: ['fetch'],
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.01,
      durationMs: 2500,
      errors: 1,
      approvals: [],
    })
    expect(two).toMatchObject({ step: 2, tools: [], costUsd: 0.02, durationMs: 1000 })
  })

  it('records approvals with their outcome on the step they were requested', () => {
    const [run] = runsFrom([
      model('m1', 1, 0),
      ev({ type: 'approval.request', id: 'a1', step: 1, ts: at(1), approval_id: 'x', action: 'send', summary: '' }),
      ev({ type: 'approval.decision', id: 'a2', step: 1, ts: at(5), approval_id: 'x', decision: 'rejected', by: { kind: 'human' } }),
    ])
    expect(summarizeSteps(run!)[0]!.approvals).toEqual([{ action: 'send', decision: 'rejected' }])
  })
})

describe('compareRuns', () => {
  const base = [model('m1', 1, 0), tool('t1', 1, 1, 'search'), model('m2', 2, 2), tool('t2', 2, 3, 'write')]

  it('reports totals deltas as b minus a', () => {
    const [a] = runsFrom(base)
    const [b] = runsFrom([...base, model('m3', 3, 4, { cost_usd: 0.05 })].map((l) => l.replace('"r1"', '"r2"')))
    const { totals } = compareRuns(a!, b!)
    expect(totals.find((r) => r.key === 'modelCalls')).toMatchObject({ a: 2, b: 3, delta: 1 })
    expect(totals.find((r) => r.key === 'costUsd')!.delta).toBeCloseTo(0.05, 9)
  })

  it('marks the first step where the runs called different tools', () => {
    const [a] = runsFrom(base)
    const [b] = runsFrom([model('m1', 1, 0), tool('t1', 1, 1, 'search'), model('m2', 2, 2), tool('t2', 2, 3, 'delete')])
    const result = compareRuns(a!, b!)
    expect(result.steps.map((s) => [s.a?.step, s.b?.step, s.differs])).toEqual([
      [1, 1, false],
      [2, undefined, true],
      [undefined, 2, true],
    ])
    expect(result.divergence?.a?.step).toBe(2)
  })

  it('aligns by what the steps did, so an extra step does not shift the rest', () => {
    const [a] = runsFrom([model('m1', 1, 0), tool('t1', 1, 1, 'search'), model('m2', 2, 2), tool('t2', 2, 3, 'draft'), model('m3', 3, 4), tool('t3', 3, 5, 'send')])
    const [b] = runsFrom([model('m1', 1, 0), tool('t1', 1, 1, 'search'), model('m3', 2, 4), tool('t3', 2, 5, 'send')])
    expect(compareRuns(a!, b!).steps.map((s) => [s.a?.step, s.b?.step])).toEqual([
      [1, 1],
      [2, undefined],
      [3, 2],
    ])
  })

  it('flags matching steps whose approvals ended differently', () => {
    const approval = (decision: string) => [
      model('m1', 1, 0),
      ev({ type: 'approval.request', id: 'a1', step: 1, ts: at(1), approval_id: 'x', action: 'send', summary: '' }),
      ev({ type: 'approval.decision', id: 'a2', step: 1, ts: at(2), approval_id: 'x', decision, by: { kind: 'human' } }),
    ]
    const [a] = runsFrom(approval('approved'))
    const [b] = runsFrom(approval('rejected'))
    expect(compareRuns(a!, b!).steps).toEqual([expect.objectContaining({ differs: true })])
  })

  it('marks steps only one run reached', () => {
    const [a] = runsFrom(base)
    const [b] = runsFrom(base.slice(0, 2))
    const result = compareRuns(a!, b!)
    expect(result.steps[1]).toMatchObject({ differs: true })
    expect(result.steps[1]!.b).toBeUndefined()
    expect(result.divergence?.a?.step).toBe(2)
  })

  it('has no divergence for identical runs', () => {
    const [a] = runsFrom(base)
    expect(compareRuns(a!, a!).divergence).toBeUndefined()
  })
})
