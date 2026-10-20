import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../ui/import/samples.ts'
import { parseLog } from './parse/detect.ts'
import { buildRuns } from './model/run.ts'
import { isUnfinished } from './derive/starts.ts'

describe('bundled samples', async () => {
  const texts = await Promise.all(SAMPLES.map((s) => s.load()))

  it.each(SAMPLES.map((s, i) => [s.file, texts[i]!] as const))('%s parses without errors', (file, text) => {
    const { events, issues } = parseLog(text)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(buildRuns(events)).toHaveLength(file.includes('two-versions') ? 2 : 1)
  })

  it('cover a failed run, estimated cost, retries, both approval kinds, an unknown event type and an unfinished call', () => {
    const runs = texts.flatMap((t) => buildRuns(parseLog(t).events))
    expect(runs.some((r) => r.status === 'failed')).toBe(true)
    expect(runs.some((r) => r.totals.costEstimated)).toBe(true)
    // Every sample shows a retry, except the fixed run kept for comparison.
    expect(runs.filter((r) => r.totals.retries === 0).map((r) => r.id)).toEqual(['run_oncall_9c21'])
    expect(runs.flatMap((r) => r.approvals.map((a) => a.decision?.by.kind))).toEqual(expect.arrayContaining(['human', 'policy']))
    expect(runs.some((r) => r.events.some((e) => e.kind === 'unknown'))).toBe(true)
    expect(runs.filter((r) => r.events.some(isUnfinished)).map((r) => r.id)).toEqual(['run_backfill_5512'])
  })
})
