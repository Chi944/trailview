import { parseJsonl } from '../core/parse/jsonl.ts'
import { buildRuns } from '../core/model/run.ts'

export const TS = '2026-10-18T09:00:00.000Z'

// Builds a JSONL line with defaults for the envelope fields.
export function ev(fields: Record<string, unknown>): string {
  return JSON.stringify({ run_id: 'r1', ts: TS, ...fields })
}

export function at(seconds: number): string {
  return new Date(Date.parse(TS) + seconds * 1000).toISOString()
}

export function runsFrom(lines: string[]) {
  const { events, issues } = parseJsonl(lines.join('\n'))
  if (issues.some((i) => i.severity === 'error')) throw new Error(JSON.stringify(issues))
  return buildRuns(events)
}
