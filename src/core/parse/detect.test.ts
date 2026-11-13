import { describe, expect, it } from 'vitest'
import { parseLog, type LogFormat } from './detect.ts'
import JSONL from '../../../samples/oncall-digest.jsonl?raw'
import OTLP from '../../../samples/otel-support-refund.json?raw'
import LANGSMITH from '../../../samples/langsmith-sql-analyst.json?raw'
import AGENTS from '../../../samples/openai-agents-support-triage.json?raw'

const minify = (text: string) => JSON.stringify(JSON.parse(text))
const perLine = (text: string) => (JSON.parse(text) as unknown[]).map((v) => JSON.stringify(v)).join('\n')

const line = (fields: Record<string, unknown>) =>
  JSON.stringify({ run_id: 'r1', id: 'e1', ts: '2026-10-18T09:14:00.000Z', ...fields })
const runStart = line({ type: 'run.start', v: 1, agent: { name: 'otel-debugger' } })

describe('format detection', () => {
  const cases: [string, string, LogFormat][] = [
    ['Trailview JSONL', JSONL, 'jsonl'],
    ['OTLP JSON, pretty-printed', OTLP, 'otlp'],
    ['OTLP JSON, on one line', minify(OTLP), 'otlp'],
    ['LangSmith runs, pretty-printed', LANGSMITH, 'langsmith'],
    ['LangSmith runs, on one line', minify(LANGSMITH), 'langsmith'],
    ['OpenAI Agents, a JSON array', AGENTS, 'openai-agents'],
    ['OpenAI Agents, one item per line', perLine(AGENTS), 'openai-agents'],
    ['OpenAI Agents, a traces API page', JSON.stringify({ object: 'list', data: JSON.parse(AGENTS) }), 'openai-agents'],
  ]
  for (const [name, text, format] of cases) {
    it(`reads ${name} as ${format}, with events and no errors`, () => {
      for (const variant of [text, `\uFEFF${text}`, `\n\n  ${text}`, text.replace(/\n/g, '\r\n')]) {
        const result = parseLog(variant)
        expect(result.format).toBe(format)
        expect(result.events.length).toBeGreaterThan(0)
        expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
      }
    })
  }

  it('falls back to JSONL for empty and unrecognised text, reporting what it could not read', () => {
    expect(parseLog('').format).toBe('jsonl')
    const result = parseLog('hello\nworld')
    expect(result.format).toBe('jsonl')
    expect(result.issues.length).toBeGreaterThan(0)
  })

  // An agent that works with traces can log another format's keys inside its
  // own payloads. The first line being a Trailview event settles it.
  it.each([
    ['OTLP', { resourceSpans: [] }],
    ['LangSmith', { run_type: 'llm', start_time: '2026-10-18T09:14:00' }],
    ['OpenAI Agents', { object: 'trace.span', id: 'span_1' }],
  ])('reads Trailview JSONL whose payloads hold %s keys as JSONL', (_, payload) => {
    const text = [runStart, line({ type: 'tool.call', id: 'e2', tool: 'fetch_trace', duration_ms: 5, status: 'ok', output: payload })].join('\n')
    const result = parseLog(text)
    expect(result.format).toBe('jsonl')
    expect(result.events).toHaveLength(2)
  })
})
