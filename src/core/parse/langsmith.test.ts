import { describe, expect, it } from 'vitest'
import sample from '../../../samples/langsmith-sql-analyst.json?raw'
import { isLangSmithJson, parseLangSmith } from './langsmith.ts'
import { parseLog } from './detect.ts'
import { buildRuns } from '../model/run.ts'

const T0 = Date.UTC(2026, 9, 19, 10, 0, 0)
// LangSmith writes UTC times without an offset.
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString().replace('Z', '')

interface RunInput {
  id: string
  type: string
  start: number
  end: number
  parent?: string
  name?: string
  trace?: string
  error?: string
  [key: string]: unknown
}

function run({ id, type, start, end, parent, name, trace = 'tr1', error, ...rest }: RunInput) {
  return {
    id,
    trace_id: trace,
    parent_run_id: parent ?? null,
    name: name ?? id,
    run_type: type,
    start_time: at(start),
    end_time: at(end),
    status: error ? 'error' : 'success',
    error: error ?? null,
    ...rest,
  }
}

const lcMessage = (kind: string, kwargs: Record<string, unknown>) => ({ lc: 1, type: 'constructor', id: ['langchain', 'schema', 'messages', kind], kwargs })

function chat(id: string, start: number, end: number, opts: { text?: string; toolCalls?: { id: string; name: string; args: unknown }[]; error?: string; usage?: Record<string, unknown> } = {}) {
  return run({
    id,
    type: 'llm',
    start,
    end,
    parent: 'root',
    name: 'ChatAnthropic',
    error: opts.error,
    extra: { metadata: { ls_provider: 'anthropic', ls_model_name: 'claude-sonnet-5-5' } },
    inputs: { messages: [[lcMessage('HumanMessage', { content: 'hi', type: 'human' })]] },
    outputs: opts.error
      ? null
      : {
          generations: [
            [
              {
                text: '',
                message: lcMessage('AIMessage', {
                  content: opts.text ?? '',
                  tool_calls: opts.toolCalls ?? [],
                  usage_metadata: opts.usage ?? { input_tokens: 100, output_tokens: 10 },
                  response_metadata: { stop_reason: opts.toolCalls ? 'tool_use' : 'end_turn' },
                }),
              },
            ],
          ],
        },
  })
}

const rootRun = (extra: Record<string, unknown> = {}) =>
  run({ id: 'root', type: 'chain', start: 0, end: 30, name: 'my-agent', inputs: { question: 'What changed?' }, outputs: { answer: 'Done.' }, ...extra })

const parse = (runs: unknown) => parseLangSmith(JSON.stringify(runs))
const byId = (runs: unknown) => new Map(parse(runs).events.map((e) => [e.event.id, e.event as Record<string, unknown>]))

describe('isLangSmithJson', () => {
  it('recognises run exports but not OTLP or Trailview JSONL', () => {
    expect(isLangSmithJson(sample)).toBe(true)
    expect(isLangSmithJson(JSON.stringify(rootRun()))).toBe(true)
    expect(isLangSmithJson('{"resourceSpans":[]}')).toBe(false)
    expect(isLangSmithJson('{"type":"run.start","run_id":"r","id":"e1","ts":"2026-10-19T10:00:00Z"}')).toBe(false)
  })
})

describe('parseLangSmith on the bundled SQL agent trace', () => {
  const { events, issues } = parseLangSmith(sample)
  const [run] = buildRuns(events)

  it('only flags the retriever as a generic row', () => {
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('langsmith.retriever') })])
  })

  it('keeps model and tool calls and drops the LangGraph node wrappers', () => {
    const types = events.map((e) => e.event.type)
    expect(types.filter((t) => t === 'model.call')).toHaveLength(7)
    expect(types.filter((t) => t === 'tool.call')).toHaveLength(5)
    expect(types).not.toContain('error')
  })

  it('builds one run with the cost logged by LangSmith', () => {
    expect(run!.agent).toMatchObject({ name: 'sql-analyst', version: '1.3.0' })
    expect(run!.status).toBe('succeeded')
    expect(run!.totals).toMatchObject({ modelCalls: 7, toolCalls: 5, retries: 1, errors: 2, approvals: 1, costEstimated: false, cacheWriteTokens: 2650 })
    expect(run!.totals.costUsd).toBeCloseTo(0.038415, 6)
    expect(run!.totals.waitMs).toBe(41870)
  })

  it('is picked by parseLog from the content', () => {
    expect(parseLog(sample).format).toBe('langsmith')
  })
})

describe('parseLangSmith mapping', () => {
  it('maps the root run to run.start and run.end, treating offset-less times as UTC', () => {
    const ev = byId([rootRun()])
    expect(ev.get('root-start')).toMatchObject({ type: 'run.start', run_id: 'tr1', ts: '2026-10-19T10:00:00.000Z', agent: { name: 'my-agent' }, input: 'What changed?' })
    expect(ev.get('root-end')).toMatchObject({ type: 'run.end', ts: '2026-10-19T10:00:30.000Z', status: 'succeeded', output: 'Done.' })
  })

  it('reads chat model output, tool calls, stop reason and usage, splitting out cache tokens', () => {
    const usage = { input_tokens: 1200, output_tokens: 40, input_token_details: { cache_read: 900, cache_creation: 100 } }
    const ev = byId([rootRun(), chat('m1', 1, 2, { text: 'Looking.', toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'x' } }], usage })])
    expect(ev.get('m1')).toMatchObject({
      type: 'model.call',
      step: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      duration_ms: 1000,
      output: { text: 'Looking.', tool_calls: [{ id: 'tc1', name: 'search', input: { q: 'x' } }] },
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 40, cache_read_tokens: 900, cache_write_tokens: 100 },
      input: [{ role: 'user', content: 'hi' }],
    })
  })

  it('uses total_cost as cost_usd, including decimal strings', () => {
    const ev = byId([rootRun(), { ...chat('m1', 1, 2), total_cost: '0.0123' }])
    expect(ev.get('m1')?.cost_usd).toBe(0.0123)
  })

  it('falls back to llm_output token usage and the class name for the provider', () => {
    const legacy = run({
      id: 'm1',
      type: 'llm',
      start: 1,
      end: 2,
      parent: 'root',
      name: 'ChatOpenAI',
      extra: { invocation_params: { model_name: 'gpt-4o' } },
      outputs: { generations: [[{ text: 'ok' }]], llm_output: { token_usage: { prompt_tokens: 50, completion_tokens: 5 } } },
    })
    expect(byId([rootRun(), legacy]).get('m1')).toMatchObject({ provider: 'openai', model: 'gpt-4o', output: { text: 'ok' }, usage: { input_tokens: 50, output_tokens: 5 } })
  })

  it('links tool runs to the model tool call by name and unwraps ToolMessage output', () => {
    const tool = run({
      id: 't1',
      type: 'tool',
      start: 3,
      end: 4,
      parent: 'root',
      name: 'search',
      inputs: { q: 'x' },
      outputs: { output: lcMessage('ToolMessage', { content: '{"hits":2}', tool_call_id: 'tc1' }) },
    })
    const untagged = { ...tool, outputs: { output: 'plain' } }
    const model = chat('m1', 1, 2, { toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'x' } }] })
    expect(byId([rootRun(), model, tool]).get('t1')).toMatchObject({ type: 'tool.call', step: 1, tool: 'search', call_id: 'tc1', input: { q: 'x' }, output: { hits: 2 } })
    expect(byId([rootRun(), model, untagged]).get('t1')).toMatchObject({ call_id: 'tc1', output: 'plain' })
  })

  it('writes calls still running at export as start lines, and leaves the run without an end', () => {
    const open = { end_time: null, outputs: null }
    const model = { ...chat('m1', 1, 2, { toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'x' } }] }) }
    const tool = { ...run({ id: 't1', type: 'tool', start: 3, end: 3, parent: 'root', name: 'search', inputs: { q: 'x' } }), ...open }
    const ev = byId([{ ...rootRun(), ...open }, model, tool])
    expect(ev.get('t1')).toEqual({ type: 'tool.start', run_id: 'tr1', id: 't1', ts: '2026-10-19T10:00:03.000Z', step: 1, tool: 'search', call_id: 'tc1', input: { q: 'x' } })
    expect(ev.has('root-end')).toBe(false)
    const [built] = buildRuns(parse([{ ...rootRun(), ...open }, model, tool]).events)
    expect(built!.status).toBe('incomplete')
    expect(built!.events.find((e) => e.event.id === 't1')!.event).toMatchObject({ type: 'tool.call', unfinished: true })
  })

  it('treats a failed model call followed by the same model as a retry, and parses the error', () => {
    const ev = byId([rootRun(), chat('m1', 1, 2, { error: "anthropic.InternalServerError: Error code: 529 - {'type': 'overloaded_error'}" }), chat('m2', 3, 4)])
    expect(ev.get('m1')).toMatchObject({ status: 'error', step: 1, error: { type: 'anthropic.InternalServerError', message: "Error code: 529 - {'type': 'overloaded_error'}" } })
    expect(ev.get('m1')).not.toHaveProperty('usage')
    expect(ev.get('m2')).toMatchObject({ step: 1, attempt: 2, retry_of: 'm1' })
  })

  it('treats a repeat of a failed tool with no model call between as a retry', () => {
    const t1 = run({ id: 't1', type: 'tool', start: 3, end: 4, parent: 'root', name: 'fetch', error: "TimeoutError('read timed out')" })
    const t2 = run({ id: 't2', type: 'tool', start: 5, end: 6, parent: 'root', name: 'fetch', outputs: { output: 'ok' } })
    const ev = byId([rootRun(), chat('m1', 1, 2, { toolCalls: [{ id: 'tc9', name: 'fetch', args: {} }] }), t1, t2])
    expect(ev.get('t1')).toMatchObject({ status: 'error', call_id: 'tc9', error: { type: 'TimeoutError', message: 'read timed out' } })
    expect(ev.get('t2')).toMatchObject({ attempt: 2, retry_of: 't1', call_id: 'tc9' })
  })

  it('reads approvals from trailview.approval.* run events', () => {
    const tool = run({
      id: 't1',
      type: 'tool',
      start: 3,
      end: 20,
      parent: 'root',
      name: 'refund',
      events: [
        { name: 'trailview.approval.request', time: at(3.1), kwargs: { approval_id: 'a1', summary: 'Refund $20', policy: 'money' } },
        { name: 'trailview.approval.decision', time: at(19), kwargs: { approval_id: 'a1', decision: 'rejected', by: { name: 'sam' }, reason: 'Too much' } },
      ],
    })
    const ev = byId([rootRun(), chat('m1', 1, 2, { toolCalls: [{ id: 'tc1', name: 'refund', args: {} }] }), tool])
    expect(ev.get('t1')).toMatchObject({ approval_id: 'a1' })
    expect(ev.get('t1-ap1')).toMatchObject({ type: 'approval.request', action: 'refund', summary: 'Refund $20', policy: 'money', call_id: 'tc1' })
    expect(ev.get('t1-ap2')).toMatchObject({ type: 'approval.decision', decision: 'rejected', by: { kind: 'human', name: 'sam' }, reason: 'Too much', ts: '2026-10-19T10:00:19.000Z' })
  })

  it('reports a wrapper that failed on its own as an error row, but not one failing because of a child', () => {
    const own = run({ id: 'n1', type: 'chain', start: 1, end: 2, parent: 'root', name: 'route', error: "KeyError('next')" })
    const wraps = run({ id: 'n2', type: 'chain', start: 3, end: 5, parent: 'root', name: 'tools', error: 'ToolException: boom' })
    const child = run({ id: 't1', type: 'tool', start: 3.5, end: 4, parent: 'n2', name: 'x', error: 'ToolException: boom' })
    const ev = byId([rootRun({ error: 'ToolException: boom', status: 'error' }), own, wraps, child])
    expect(ev.get('n1')).toMatchObject({ type: 'error', error: { type: 'KeyError', message: 'next' } })
    expect(ev.has('n2')).toBe(false)
    expect(ev.get('root-end')).toMatchObject({ status: 'failed', error: { type: 'ToolException', message: 'boom' } })
  })

  it('accepts nested child_runs, {"runs": [...]}, and one run per line, splitting traces', () => {
    const nested = { ...rootRun(), child_runs: [{ ...chat('m1', 1, 2), trace_id: undefined, parent_run_id: undefined }] }
    expect(parse(nested).events.map((e) => e.event.id)).toEqual(['root-start', 'm1', 'root-end'])
    expect(parse({ runs: [rootRun()] }).events).toHaveLength(2)
    const lines = [rootRun(), rootRun({ id: 'root2', trace_id: 'tr2' })].map((r) => JSON.stringify(r)).join('\n')
    const runs = buildRuns(parseLangSmith(lines).events)
    expect(runs.map((r) => r.id)).toEqual(['tr1', 'tr2'])
  })

  it('reports bad lines and runs without the required fields', () => {
    const { issues } = parseLangSmith(`${JSON.stringify(rootRun())}\nnot json\n${JSON.stringify({ name: 'x', run_type: 'tool' })}`)
    expect(issues).toEqual([
      expect.objectContaining({ line: 2, severity: 'error', message: expect.stringContaining('Not valid JSON') }),
      expect.objectContaining({ line: 3, severity: 'error', message: expect.stringContaining('missing id') }),
    ])
  })
})
