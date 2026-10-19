import type { ParsedEvent } from '../parse/jsonl.ts'
import type { ErrorInfo, RunStartEvent } from '../schema/events.ts'
import { pairApprovals, type Approval } from '../derive/approvals.ts'
import { foldRetries, type TimelineItem } from '../derive/retries.ts'
import { computeTotals, type Totals } from '../derive/totals.ts'

export type RunStatus = 'succeeded' | 'failed' | 'cancelled' | 'incomplete'

export interface Run {
  id: string
  agent?: RunStartEvent['agent']
  schemaVersion?: number
  input?: unknown
  output?: unknown
  error?: ErrorInfo
  status: RunStatus
  startMs: number
  endMs: number
  // Events in timeline order: by timestamp, then by line in the file.
  events: ParsedEvent[]
  items: TimelineItem[]
  approvals: Approval[]
  totals: Totals
}

// Groups parsed events into runs, in the order each run first appears.
export function buildRuns(parsed: ParsedEvent[]): Run[] {
  const groups = new Map<string, ParsedEvent[]>()
  for (const p of parsed) {
    const list = groups.get(p.event.run_id) ?? []
    list.push(p)
    groups.set(p.event.run_id, list)
  }
  return [...groups].map(([id, events]) => buildRun(id, events))
}

function buildRun(id: string, unsorted: ParsedEvent[]): Run {
  const events = [...unsorted].sort((a, b) => Date.parse(a.event.ts) - Date.parse(b.event.ts) || a.line - b.line)

  let start: RunStartEvent | undefined
  let status: RunStatus = 'incomplete'
  let output: unknown
  let error: ErrorInfo | undefined
  let startMs = Infinity
  let endMs = -Infinity
  for (const p of events) {
    const event = p.event
    const ts = Date.parse(event.ts)
    const duration = typeof event.duration_ms === 'number' ? event.duration_ms : 0
    startMs = Math.min(startMs, ts)
    endMs = Math.max(endMs, ts + duration)
    if (p.kind !== 'known') continue
    if (p.event.type === 'run.start') start ??= p.event
    if (p.event.type === 'run.end') {
      status = p.event.status
      output = p.event.output
      error = p.event.error
    }
  }

  const approvals = pairApprovals(events)
  const wallMs = events.length ? endMs - startMs : 0
  return {
    id,
    agent: start?.agent,
    schemaVersion: start?.v,
    input: start?.input,
    output,
    error,
    status,
    startMs: events.length ? startMs : 0,
    endMs: events.length ? endMs : 0,
    events,
    items: foldRetries(events),
    approvals,
    totals: computeTotals(events, approvals, wallMs, start?.pricing),
  }
}
