import { describe, expect, it } from 'vitest'
import sample from '../../../samples/otel-support-refund.json?raw'
import { isOtlpJson, parseOtlp } from './otel.ts'
import { parseLog } from './detect.ts'
import { buildRuns } from '../model/run.ts'

const T0 = 1792404000n * 1_000_000_000n
const at = (sec: number) => String(T0 + BigInt(Math.round(sec * 1e9)))
const attr = (key: string, value: string | number) =>
  typeof value === 'number' ? { key, value: { intValue: value } } : { key, value: { stringValue: value } }

interface SpanInput {
  id: string
  op?: string
  start: number
  end: number
  attrs?: Record<string, string | number>
  error?: string
  trace?: string
}

function otlp(spans: SpanInput[], service = 'svc'): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: [attr('service.name', service)] },
        scopeSpans: [
          {
            spans: spans.map((s) => ({
              traceId: s.trace ?? 't1',
              spanId: s.id,
              name: s.id,
              startTimeUnixNano: at(s.start),
              endTimeUnixNano: at(s.end),
              attributes: Object.entries({ ...(s.op && { 'gen_ai.operation.name': s.op }), ...s.attrs }).map(([k, v]) => attr(k, v)),
              status: s.error ? { code: 2, message: s.error } : { code: 0 },
            })),
          },
        ],
      },
    ],
  })
}

const byId = (text: string) => new Map(parseOtlp(text).events.map((e) => [e.event.id, e.event as Record<string, unknown>]))

describe('isOtlpJson', () => {
  it('recognises a single document and one export per line, but not Trailview JSONL', () => {
    expect(isOtlpJson(sample)).toBe(true)
    expect(isOtlpJson(`${otlp([])}\n${otlp([])}`)).toBe(true)
    expect(isOtlpJson('{"type":"run.start","run_id":"r","id":"e1","ts":"2026-10-19T10:00:00Z"}')).toBe(false)
  })
})

describe('parseOtlp on the bundled support trace', () => {
  const { events, issues } = parseOtlp(sample)
  const [run] = buildRuns(events)
  const ev = new Map(events.map((e) => [e.event.id, e.event as Record<string, unknown>]))

  it('reports only the skipped HTTP span and the generic retrieval row', () => {
    expect(issues.map((i) => [i.severity, i.message])).toEqual([
      ['warning', '1 span(s) without gen_ai.operation.name were skipped'],
      ['warning', 'Unknown event type "otel.retrieval", shown as a generic row'],
    ])
  })

  it('turns the invoke_agent span into the run', () => {
    expect(run).toMatchObject({ id: '5b8efff798038103d269b633813fc60c', status: 'succeeded', agent: { name: 'support-desk', version: '1.3.0' } })
    expect(run!.totals.wallMs).toBe(41_800)
    expect(run!.input).toBe('Order #A-1042 arrived with a cracked screen. Can I get a refund?')
    expect(ev.get('a1b2c3d4e5f60001-end')).toMatchObject({ type: 'run.end', output: expect.stringContaining('re_7731') })
  })

  it('maps chat spans to model calls with uncached input tokens and tool calls', () => {
    expect(ev.get('a1b2c3d4e5f60002')).toMatchObject({
      type: 'model.call',
      step: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      duration_ms: 2280,
      stop_reason: 'tool_use',
      usage: { input_tokens: 540, cache_read_tokens: 1600, output_tokens: 118 },
      output: { tool_calls: [{ id: 'toolu_01', name: 'lookup_order', input: { order_id: 'A-1042' } }] },
    })
  })

  it('links a failed model call to the call that follows it as a retry in the same step', () => {
    expect(ev.get('a1b2c3d4e5f60006')).toMatchObject({ status: 'error', step: 2, error: { type: 'overloaded_error', message: '529 Overloaded' } })
    expect(ev.get('a1b2c3d4e5f60007')).toMatchObject({ step: 2, attempt: 2, retry_of: 'a1b2c3d4e5f60006' })
    expect(ev.get('a1b2c3d4e5f60009')).toMatchObject({ step: 3 })
  })

  it('reads approvals from trailview.approval span events', () => {
    expect(ev.get('a1b2c3d4e5f60008')).toMatchObject({ type: 'tool.call', tool: 'issue_refund', approval_id: 'ap_refund_1' })
    expect(run!.approvals).toEqual([expect.objectContaining({ approvalId: 'ap_refund_1', outcome: 'approved', waitMs: 28_850 })])
    expect(ev.get('a1b2c3d4e5f60008-ap1')).toMatchObject({ type: 'approval.request', call_id: 'toolu_02', policy: 'refund_over_50' })
  })

  it('totals tokens across every attempt and estimates the cost', () => {
    expect(run!.totals).toMatchObject({
      modelCalls: 4,
      toolCalls: 2,
      retries: 1,
      inputTokens: 540 + 1880 + 610,
      cacheReadTokens: 6400,
      outputTokens: 419,
      costEstimated: true,
    })
  })
})

describe('parseOtlp edge cases', () => {
  it('synthesises the run from the spans when there is no invoke_agent span', () => {
    const text = otlp(
      [
        { id: 's1', op: 'chat', start: 1, end: 2, attrs: { 'gen_ai.request.model': 'm', 'gen_ai.provider.name': 'p' } },
        { id: 's2', op: 'execute_tool', start: 2, end: 5, attrs: { 'gen_ai.tool.name': 'grep' }, error: 'exit 1' },
      ],
      'my-agent',
    )
    const [run] = buildRuns(parseOtlp(text).events)
    expect(run).toMatchObject({ id: 't1', status: 'failed', agent: { name: 'my-agent' }, startMs: 1792404001000 })
    expect(run!.totals.wallMs).toBe(4000)
  })

  it('treats a repeated tool call id after an error as a retry', () => {
    const tool = { op: 'execute_tool', attrs: { 'gen_ai.tool.name': 'fetch', 'gen_ai.tool.call.id': 'c1' } }
    const ev = byId(otlp([{ id: 'a', ...tool, start: 0, end: 1, error: 'timeout' }, { id: 'b', ...tool, start: 2, end: 3 }]))
    expect(ev.get('b')).toMatchObject({ attempt: 2, retry_of: 'a', call_id: 'c1' })
  })

  it('keeps one run per trace and reads one export request per line', () => {
    const text = `${otlp([{ id: 'x', op: 'chat', start: 0, end: 1 }])}\n${otlp([{ id: 'y', op: 'chat', start: 0, end: 1, trace: 't2' }])}`
    expect(buildRuns(parseOtlp(text).events).map((r) => r.id)).toEqual(['t1', 't2'])
  })

  it('counts input tokens as uncached when the cache counts are missing', () => {
    const ev = byId(otlp([{ id: 'm', op: 'chat', start: 0, end: 1, attrs: { 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 7 } }]))
    expect(ev.get('m')).toMatchObject({ provider: 'unknown', model: 'unknown', usage: { input_tokens: 100, output_tokens: 7 } })
  })

  it('reports bad lines and spans without ids instead of throwing', () => {
    const missing = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'broken' }] }] }] })
    const { issues } = parseOtlp(`${otlp([])}\nnot json\n${missing}`)
    expect(issues.map((i) => [i.line, i.severity])).toEqual([
      [2, 'error'],
      [3, 'error'],
    ])
  })

  it('says so when a trace has no GenAI spans at all', () => {
    const { events, issues } = parseOtlp(otlp([{ id: 'h', start: 0, end: 1, attrs: { 'http.request.method': 'GET' } }]))
    expect(events).toEqual([])
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'error'])
  })
})

describe('parseLog', () => {
  it('picks the parser from the content', () => {
    expect(parseLog(sample).format).toBe('otlp')
    expect(parseLog('{"type":"log","run_id":"r","id":"1","ts":"2026-10-19T10:00:00Z","message":"hi"}').format).toBe('jsonl')
  })
})
