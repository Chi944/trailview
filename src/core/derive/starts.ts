import type { ParsedEvent } from '../parse/jsonl.ts'
import type { ModelCallEvent, ModelStartEvent, ToolCallEvent, ToolStartEvent } from '../schema/events.ts'

export const UNFINISHED_ERROR_TYPE = 'unfinished'

// Folds model.start / tool.start lines into the calls they began. A start
// that a finished call points at (start_id, or the same call_id for tools) is
// dropped, since the finished call is the record. A start nothing finished
// becomes a call with status "error" and `unfinished: true`, lasting until
// the last moment the log covers, so a run that crashed mid-call still shows
// what it was waiting on. Expects events in timeline order.
export function resolveStarts(events: ParsedEvent[]): ParsedEvent[] {
  const finishedStartIds = new Set<string>()
  const finishedCallIds = new Set<string>()
  let logEndMs = -Infinity
  for (const parsed of events) {
    const event = parsed.event
    if (parsed.kind === 'known' && (event.type === 'model.start' || event.type === 'tool.start')) continue
    const duration = typeof event.duration_ms === 'number' ? event.duration_ms : 0
    logEndMs = Math.max(logEndMs, Date.parse(event.ts) + duration)
    if (parsed.kind !== 'known') continue
    const known = parsed.event
    if (known.type !== 'model.call' && known.type !== 'tool.call') continue
    if (known.start_id) finishedStartIds.add(known.start_id)
    if (known.type === 'tool.call' && known.call_id) finishedCallIds.add(known.call_id)
  }

  const resolved: ParsedEvent[] = []
  for (const parsed of events) {
    if (parsed.kind !== 'known') {
      resolved.push(parsed)
      continue
    }
    const event = parsed.event
    if (event.type !== 'model.start' && event.type !== 'tool.start') {
      resolved.push(parsed)
      continue
    }
    const finished =
      finishedStartIds.has(event.id) || (event.type === 'tool.start' && event.call_id !== undefined && finishedCallIds.has(event.call_id))
    if (finished) continue
    const startMs = Date.parse(event.ts)
    const durationMs = Number.isFinite(logEndMs) ? Math.max(0, logEndMs - startMs) : 0
    resolved.push({ kind: 'known', line: parsed.line, event: unfinishedCall(event, durationMs), source: event })
  }
  return resolved
}

function unfinishedCall(start: ModelStartEvent | ToolStartEvent, durationMs: number): ModelCallEvent | ToolCallEvent {
  const fields = {
    start_id: start.id,
    duration_ms: durationMs,
    status: 'error' as const,
    error: { type: UNFINISHED_ERROR_TYPE, message: 'Started but never finished: the log ends before this call returned.' },
    unfinished: true,
  }
  return start.type === 'model.start' ? { ...start, ...fields, type: 'model.call' } : { ...start, ...fields, type: 'tool.call' }
}

export function isUnfinished(parsed: ParsedEvent): boolean {
  return parsed.kind === 'known' && parsed.event.unfinished === true
}
