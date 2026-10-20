import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../ui/import/samples.ts'
import { parseLog } from './parse/detect.ts'
import { buildRuns } from './model/run.ts'

describe('bundled samples', () => {
  it.each(SAMPLES.map((s) => [s.file, s] as const))('%s parses into one run', (_, sample) => {
    const { events, issues } = parseLog(sample.text)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(buildRuns(events)).toHaveLength(1)
  })

  it('cover a failed run, estimated cost, retries, both approval kinds and an unknown event type', () => {
    const runs = SAMPLES.map((s) => buildRuns(parseLog(s.text).events)[0]!)
    expect(runs.some((r) => r.status === 'failed')).toBe(true)
    expect(runs.some((r) => r.totals.costEstimated)).toBe(true)
    expect(runs.every((r) => r.totals.retries > 0)).toBe(true)
    expect(runs.flatMap((r) => r.approvals.map((a) => a.decision?.by.kind))).toEqual(expect.arrayContaining(['human', 'policy']))
    expect(runs.some((r) => r.events.some((e) => e.kind === 'unknown'))).toBe(true)
  })
})
