import { describe, expect, it } from 'vitest'
import sample from '../../test/schema-example.jsonl?raw'
import { parseJsonl } from './jsonl.ts'

const base = { run_id: 'r1', ts: '2026-10-18T09:14:02.120Z' }
const line = (fields: Record<string, unknown>) => JSON.stringify({ ...base, ...fields })
const runStart = line({ type: 'run.start', id: 'e1', v: 1, agent: { name: 'a' } })

describe('parseJsonl', () => {
  it('parses the docs/schema.md example without issues', () => {
    const { events, issues } = parseJsonl(sample)
    expect(issues).toEqual([])
    expect(events).toHaveLength(13)
    expect(events.every((e) => e.kind === 'known')).toBe(true)
    expect(events.map((e) => e.event.type)).toEqual([
      'run.start',
      'model.call',
      'tool.call',
      'tool.call',
      'model.call',
      'approval.request',
      'approval.decision',
      'model.call',
      'approval.request',
      'approval.decision',
      'tool.call',
      'model.call',
      'run.end',
    ])
  })

  it('keeps retry and approval links from the example', () => {
    const { events } = parseJsonl(sample)
    const byId = new Map(events.map((e) => [e.event.id, e.event]))
    expect(byId.get('e04')).toMatchObject({ type: 'tool.call', attempt: 2, retry_of: 'e03', status: 'ok' })
    expect(byId.get('e03')).toMatchObject({ status: 'error', error: { type: 'timeout', retryable: true } })
    expect(byId.get('e07')).toMatchObject({ approval_id: 'ap_1', decision: 'rejected' })
    expect(byId.get('e11')).toMatchObject({ approval_id: 'ap_2', call_id: 'tu_3' })
  })

  it('records 1-based line numbers and skips blank lines and CRLF', () => {
    const text = `\r\n${runStart}\r\n\r\n${line({ type: 'log', id: 'e2', message: 'hi' })}\r\n`
    const { events, issues } = parseJsonl(text)
    expect(issues).toEqual([])
    expect(events.map((e) => e.line)).toEqual([2, 4])
  })

  it('strips a leading byte-order mark', () => {
    const { events, issues } = parseJsonl(`\uFEFF${runStart}`)
    expect(issues).toEqual([])
    expect(events).toHaveLength(1)
  })

  it('reports bad JSON and keeps reading the rest of the file', () => {
    const text = [runStart, '{"type": "log",', line({ type: 'log', id: 'e3', message: 'after' })].join('\n')
    const { events, issues } = parseJsonl(text)
    expect(events.map((e) => e.line)).toEqual([1, 3])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ line: 2, severity: 'error' })
    expect(issues[0]?.message).toMatch(/^Not valid JSON/)
  })

  it('rejects lines that are not objects', () => {
    const { events, issues } = parseJsonl('[1,2]\n42\n"text"')
    expect(events).toEqual([])
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3])
    expect(issues.every((i) => i.message === 'Expected a JSON object')).toBe(true)
  })

  it('names the missing envelope field', () => {
    const { issues } = parseJsonl(JSON.stringify({ type: 'log', id: 'e1', ts: base.ts, message: 'x' }))
    expect(issues[0]?.message).toMatch(/run_id/)
  })

  it('rejects timestamps that are not ISO 8601', () => {
    const { events, issues } = parseJsonl(line({ type: 'log', id: 'e1', ts: 'yesterday', message: 'x' }))
    expect(events).toEqual([])
    expect(issues[0]?.message).toMatch(/^ts:/)
  })

  it('names the bad field on a known event type', () => {
    const text = line({ type: 'model.call', id: 'e1', provider: 'p', model: 'm', duration_ms: 'slow', status: 'ok' })
    const { events, issues } = parseJsonl(text)
    expect(events).toEqual([])
    expect(issues[0]).toMatchObject({ line: 1, severity: 'error' })
    expect(issues[0]?.message).toMatch(/^model\.call: duration_ms:/)
  })

  it('rejects an approval decision that is neither approved nor rejected', () => {
    const text = line({ type: 'approval.decision', id: 'e1', approval_id: 'a', decision: 'maybe', by: { kind: 'human' } })
    const { issues } = parseJsonl(text)
    expect(issues[0]?.message).toMatch(/decision/)
  })

  it('keeps unknown event types as generic rows with a warning', () => {
    const { events, issues } = parseJsonl(line({ type: 'custom.thing', id: 'e1', foo: 1 }))
    expect(events).toEqual([{ kind: 'unknown', line: 1, event: expect.objectContaining({ type: 'custom.thing', foo: 1 }) }])
    expect(issues).toEqual([{ line: 1, severity: 'warning', message: expect.stringMatching(/custom\.thing/) }])
  })

  it('keeps unknown fields on known events', () => {
    const { events } = parseJsonl(line({ type: 'log', id: 'e1', message: 'x', extra: { a: 1 } }))
    expect(events[0]?.event).toMatchObject({ extra: { a: 1 } })
  })

  it('warns on duplicate ids within a run but not across runs', () => {
    const text = [
      runStart,
      line({ type: 'log', id: 'e1', message: 'dup' }),
      line({ type: 'log', id: 'e1', run_id: 'r2', message: 'other run' }),
    ].join('\n')
    const { events, issues } = parseJsonl(text)
    expect(events).toHaveLength(3)
    expect(issues).toEqual([{ line: 2, severity: 'warning', message: 'Duplicate id "e1" in run "r1"' }])
  })

  it('reads several runs from one file', () => {
    const text = [runStart, line({ type: 'run.start', id: 'e1', run_id: 'r2', v: 1, agent: { name: 'b' } })].join('\n')
    const { events, issues } = parseJsonl(text)
    expect(issues).toEqual([])
    expect(events.map((e) => e.event.run_id)).toEqual(['r1', 'r2'])
  })

  it('accepts a run with no run.end', () => {
    const { events, issues } = parseJsonl([runStart, line({ type: 'log', id: 'e2', message: 'x' })].join('\n'))
    expect(issues).toEqual([])
    expect(events.some((e) => e.event.type === 'run.end')).toBe(false)
  })

  it('warns when the schema version is newer than the viewer', () => {
    const { events, issues } = parseJsonl(line({ type: 'run.start', id: 'e1', v: 2, agent: { name: 'a' } }))
    expect(events).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', message: expect.stringMatching(/version 2/) })
  })

  it('returns nothing for an empty file', () => {
    expect(parseJsonl('')).toEqual({ events: [], issues: [] })
  })
})
