import { describe, expect, it } from 'vitest'
import guide from '../../docs/your-own-logs.md?raw'
import { parseLog } from './parse/detect.ts'
import { buildRuns } from './model/run.ts'

// The first jsonl block in docs/your-own-logs.md is the minimal run readers copy.
const example = /```jsonl\n([\s\S]*?)```/.exec(guide)![1]!

describe('docs/your-own-logs.md example', () => {
  it('parses as one clean, finished run with an estimated cost', () => {
    const { format, events, issues } = parseLog(example)
    expect(format).toBe('jsonl')
    expect(issues).toEqual([])
    const runs = buildRuns(events)
    expect(runs).toHaveLength(1)
    const [run] = runs
    expect(run!.status).toBe('succeeded')
    expect(run!.totals).toMatchObject({ modelCalls: 2, toolCalls: 1, errors: 0, inputTokens: 930, outputTokens: 52, costEstimated: true, unpricedCalls: 0 })
  })
})
