import type { z } from 'zod'
import {
  SCHEMA_VERSION,
  envelopeSchema,
  isKnownEventType,
  knownEventSchema,
  type Envelope,
  type KnownEvent,
} from '../schema/events.ts'

export type ParsedEvent =
  // `source` is the line as written, when the viewer derived `event` from it
  // (an unfinished model.start shown as a failed model.call).
  | { kind: 'known'; line: number; event: KnownEvent; source?: KnownEvent }
  | { kind: 'unknown'; line: number; event: Envelope }

export interface ParseIssue {
  line: number
  // 'error': the line was skipped. 'warning': the line was kept but looks wrong.
  severity: 'error' | 'warning'
  message: string
}

export interface ParseResult {
  events: ParsedEvent[]
  issues: ParseIssue[]
}

// Parses a Trailview JSONL file. Never throws: each bad line becomes an issue
// with its 1-based line number and the rest of the file is still read.
export function parseJsonl(text: string): ParseResult {
  const records: EventRecord[] = []
  const issues: ParseIssue[] = []

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = index + 1
    if (raw.trim() === '') return
    try {
      records.push({ line, value: JSON.parse(raw) })
    } catch (err) {
      issues.push({ line, severity: 'error', message: `Not valid JSON: ${(err as Error).message}` })
    }
  })

  return validateEvents(records, issues)
}

export interface EventRecord {
  // Where the record came from, for issue messages.
  line: number
  value: unknown
}

// Validates already-decoded event objects against the schema. Shared by the
// JSONL parser and the format adapters so every input gets the same checks.
export function validateEvents(records: EventRecord[], initialIssues: ParseIssue[] = []): ParseResult {
  const events: ParsedEvent[] = []
  const issues = [...initialIssues]
  const seenIds = new Map<string, Set<string>>()

  for (const { line, value } of records) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ line, severity: 'error', message: 'Expected a JSON object' })
      continue
    }

    const envelope = envelopeSchema.safeParse(value)
    if (!envelope.success) {
      issues.push({ line, severity: 'error', message: describe(envelope.error) })
      continue
    }

    const { type, run_id, id } = envelope.data
    const ids = seenIds.get(run_id) ?? new Set<string>()
    seenIds.set(run_id, ids)
    if (ids.has(id)) {
      issues.push({ line, severity: 'warning', message: `Duplicate id "${id}" in run "${run_id}"` })
    }
    ids.add(id)

    if (!isKnownEventType(type)) {
      issues.push({ line, severity: 'warning', message: `Unknown event type "${type}", shown as a generic row` })
      events.push({ kind: 'unknown', line, event: envelope.data })
      continue
    }

    const known = knownEventSchema.safeParse(value)
    if (!known.success) {
      issues.push({ line, severity: 'error', message: `${type}: ${describe(known.error)}` })
      continue
    }
    if (known.data.type === 'run.start' && known.data.v > SCHEMA_VERSION) {
      issues.push({
        line,
        severity: 'warning',
        message: `Schema version ${known.data.v} is newer than this viewer (${SCHEMA_VERSION}); some fields may be ignored`,
      })
    }
    events.push({ kind: 'known', line, event: known.data })
  }

  // Stable sort keeps issues from the same line in the order they were found.
  issues.sort((a, b) => a.line - b.line)
  return { events, issues }
}

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')
}
