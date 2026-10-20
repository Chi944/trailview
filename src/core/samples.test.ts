import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../ui/import/samples.ts'
import { parseLog } from './parse/detect.ts'
import { buildRuns } from './model/run.ts'

describe('bundled samples', async () => {
  const texts = await Promise.all(SAMPLES.map((s) => s.load()))

  it.each(SAMPLES.map((s, i) => [s.file, texts[i]!] as const))('%s parses into one run', (_, text) => {
    const { events, issues } = parseLog(text)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(buildRuns(events)).toHaveLength(1)
  })

  it('cover a failed run, estimated cost, retries, both approval kinds and an unknown event type', () => {
    const runs = texts.map((t) => buildRuns(parseLog(t).events)[0]!)
    expect(runs.some((r) => r.status === 'failed')).toBe(true)
    expect(runs.some((r) => r.totals.costEstimated)).toBe(true)
    expect(runs.every((r) => r.totals.retries > 0)).toBe(true)
    expect(runs.flatMap((r) => r.approvals.map((a) => a.decision?.by.kind))).toEqual(expect.arrayContaining(['human', 'policy']))
    expect(runs.some((r) => r.events.some((e) => e.kind === 'unknown'))).toBe(true)
  })
})
