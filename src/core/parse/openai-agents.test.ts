import { describe, expect, it } from 'vitest'
import sample from '../../../samples/openai-agents-support-triage.json?raw'
import { isOpenAiAgentsJson, parseOpenAiAgents } from './openai-agents.ts'
import { parseLog } from './detect.ts'
import { buildRuns } from '../model/run.ts'

const T0 = Date.parse('2026-10-23T09:00:00.000Z')
// The Python SDK writes ISO times with a +00:00 offset.
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString().replace('Z', '+00:00')

interface SpanInput {
  id: string
  type: string
  start: number
  end?: number
  parent?: string
  trace?: string
  error?: Record<string, unknown>
  [key: string]: unknown
}

function span({ id, type, start, end, parent, trace = 'trace_1', error, ...data }: SpanInput) {
  return {
    object: 'trace.span',
    id,
    trace_id: trace,
    parent_id: parent ?? null,
    started_at: at(start),
    ended_at: end === undefined ? null : at(end),
    span_data: { type, ...data },
    error: error ?? null,
  }
}

const agent = (id: string, name: string, start: number, end?: number, parent?: string) => span({ id, type: 'agent', name, start, end, parent, handoffs: [], tools: [] })

interface ResponseOpts {
  text?: string
  toolCalls?: { id: string; name: string; args: unknown }[]
  usage?: Record<string, unknown>
  input?: unknown
  model?: string
  error?: Record<string, unknown>
}

function response(id: string, start: number, end: number | undefined, parent: string, opts: ResponseOpts = {}) {
  const output = [
    ...(opts.text ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: opts.text }] }] : []),
    ...(opts.toolCalls ?? []).map((c) => ({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) })),
  ]
  return span({
    id,
    type: 'response',
    start,
    end,
    parent,
    response_id: `resp_${id}`,
    model: opts.model ?? 'gpt-4o',
    input: opts.input ?? [{ role: 'user', content: 'refund my order' }],
    ...(opts.usage && { usage: opts.usage }),
    ...(output.length > 0 && { output }),
    error: opts.error,
  })
}

const fn = (id: string, name: string, start: number, end: number | undefined, parent: string, extra: Record<string, unknown> = {}) =>
  span({ id, type: 'function', name, start, end, parent, input: JSON.stringify({ q: 1 }), output: 'done', ...extra })

const trace = (extra: Record<string, unknown> = {}) => ({ object: 'trace', id: 'trace_1', workflow_name: 'support', ...extra })

const text = (items: unknown[]) => JSON.stringify(items)
const events = (items: unknown[]) => parseOpenAiAgents(text(items))

describe('isOpenAiAgentsJson', () => {
  it('recognises an export of traces and spans', () => {
    expect(isOpenAiAgentsJson(text([trace(), agent('a1', 'Triage', 0, 1)]))).toBe(true)
    expect(isOpenAiAgentsJson(text([agent('a1', 'Triage', 0, 1)]))).toBe(true)
    expect(isOpenAiAgentsJson(JSON.stringify({ data: [agent('a1', 'Triage', 0, 1)] }))).toBe(true)
  })

  it('leaves the other formats alone', () => {
    expect(isOpenAiAgentsJson('{"resourceSpans":[]}')).toBe(false)
    expect(isOpenAiAgentsJson('{"run_type":"llm","start_time":"2026-10-19T10:00:00"}')).toBe(false)
    expect(isOpenAiAgentsJson('{"type":"run.start","v":1}')).toBe(false)
  })
})

describe('parseOpenAiAgents', () => {
  it('turns the first agent into the run and its calls into steps', () => {
    const { events: parsed, issues } = events([
      trace({ metadata: { env: 'local' }, group_id: 'conv_1' }),
      agent('a1', 'Triage', 0, 10),
      response('r1', 0.5, 2, 'a1', { text: 'looking it up', toolCalls: [{ id: 'call_1', name: 'lookup', args: { id: 7 } }], usage: { input_tokens: 100, output_tokens: 20 } }),
      fn('f1', 'lookup', 2.1, 3, 'a1'),
      response('r2', 3.1, 5, 'a1', { text: 'all done', usage: { input_tokens: 200, output_tokens: 10 } }),
    ])
    expect(issues).toEqual([])
    const [run] = buildRuns(parsed)
    expect(run!.id).toBe('trace_1')
    expect(run!.status).toBe('succeeded')
    expect(run!.totals.modelCalls).toBe(2)
    expect(run!.totals.toolCalls).toBe(1)

    const start = parsed[0]!.event as { type: string; agent: { name: string }; input: unknown; attrs: Record<string, unknown> }
    // workflow_name names the run; the trace's metadata is kept on it.
    expect(start.agent.name).toBe('support')
    expect(start.input).toBe('refund my order')
    expect(start.attrs).toMatchObject({ source: 'openai-agents', trace_id: 'trace_1', group_id: 'conv_1', env: 'local' })

    const model = parsed[1]!.event as { type: string; model: string; provider: string; step: number; output: { text: string; tool_calls: { id: string; name: string; input: unknown }[] }; usage: Record<string, number> }
    expect(model.type).toBe('model.call')
    expect(model.provider).toBe('openai')
    expect(model.step).toBe(1)
    expect(model.output.tool_calls).toEqual([{ id: 'call_1', name: 'lookup', input: { id: 7 } }])
    expect(model.usage).toEqual({ input_tokens: 100, output_tokens: 20 })

    const tool = parsed[2]!.event as { type: string; tool: string; call_id: string; step: number; input: unknown }
    expect(tool.type).toBe('tool.call')
    // The tool is matched to the call the model asked for, and shares its step.
    expect(tool.call_id).toBe('call_1')
    expect(tool.step).toBe(1)
    expect(tool.input).toEqual({ q: 1 })

    expect((parsed[3]!.event as { step: number }).step).toBe(2)
    const end = parsed[4]!.event as { type: string; status: string; output: unknown }
    expect(end.type).toBe('run.end')
    expect(end.status).toBe('succeeded')
    expect(end.output).toBe('all done')
  })

  it('reads the agent name when the workflow has the SDK default name', () => {
    const { events: parsed } = events([trace({ workflow_name: 'Agent workflow' }), agent('a1', 'Triage', 0, 2), response('r1', 0.2, 1, 'a1', { text: 'hi' })])
    expect((parsed[0]!.event as { agent: { name: string } }).agent.name).toBe('Triage')
  })

  it('reads Chat Completions messages from a generation span', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 5),
      span({
        id: 'g1',
        type: 'generation',
        start: 0.2,
        end: 2,
        parent: 'a1',
        model: 'gpt-4o-mini',
        input: [{ role: 'user', content: 'hi' }],
        output: [{ role: 'assistant', content: 'on it', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'lookup', arguments: '{"id":3}' } }] }],
        usage: { prompt_tokens: 80, completion_tokens: 12 },
      }),
    ])
    const model = parsed[1]!.event as { model: string; output: { text: string; tool_calls: { id: string; name: string; input: unknown }[] }; usage: Record<string, number> }
    expect(model.model).toBe('gpt-4o-mini')
    expect(model.output.text).toBe('on it')
    expect(model.output.tool_calls).toEqual([{ id: 'call_9', name: 'lookup', input: { id: 3 } }])
    expect(model.usage).toEqual({ input_tokens: 80, output_tokens: 12 })
  })

  it('keeps cached tokens out of the input count', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 5),
      response('r1', 0.2, 2, 'a1', { text: 'hi', usage: { input_tokens: 1000, output_tokens: 10, input_tokens_details: { cached_tokens: 400 } } }),
    ])
    expect((parsed[1]!.event as { usage: Record<string, number> }).usage).toEqual({ input_tokens: 600, output_tokens: 10, cache_read_tokens: 400 })
  })

  it('names the provider from a routed model id', () => {
    const { events: parsed } = events([trace(), agent('a1', 'Triage', 0, 5), response('r1', 0.2, 2, 'a1', { model: 'anthropic/claude-sonnet-5-5', text: 'hi' })])
    expect((parsed[1]!.event as { provider: string }).provider).toBe('anthropic')
  })

  it('marks a failed call and its retry', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 10),
      response('r1', 0.2, 1, 'a1', { error: { message: 'Error getting response', data: { type: 'rate_limit_error', error: 'Rate limit reached' } } }),
      response('r2', 2, 4, 'a1', { text: 'done', usage: { input_tokens: 10, output_tokens: 2 } }),
    ])
    const failed = parsed[1]!.event as { status: string; error: { type: string; message: string }; step: number }
    expect(failed.status).toBe('error')
    expect(failed.error).toEqual({ type: 'rate_limit_error', message: 'Rate limit reached' })
    const retry = parsed[2]!.event as { attempt: number; retry_of: string; step: number }
    // A retry stays in the step it is retrying.
    expect(retry).toMatchObject({ attempt: 2, retry_of: 'r1', step: 1 })
    expect(failed.step).toBe(1)
  })

  it('marks a failed tool and its retry, and fails the run when the agent failed', () => {
    const { events: parsed } = events([
      trace(),
      { ...agent('a1', 'Triage', 0, 10), error: { message: 'Run failed', data: { type: 'tool_error', error: 'lookup gave up' } } },
      response('r1', 0.2, 1, 'a1', { toolCalls: [{ id: 'call_1', name: 'lookup', args: {} }] }),
      fn('f1', 'lookup', 1.1, 2, 'a1', { error: { message: 'Error running tool', data: { error: 'timed out' } } }),
      fn('f2', 'lookup', 2.1, 3, 'a1'),
    ])
    const failed = parsed[2]!.event as { status: string; error: { type: string; message: string }; call_id: string }
    expect(failed.status).toBe('error')
    expect(failed.error).toEqual({ type: 'tool_error', message: 'timed out' })
    // The retry inherits the call id of the attempt it repeats.
    expect((parsed[3]!.event as { attempt: number; retry_of: string; call_id: string })).toMatchObject({ attempt: 2, retry_of: 'f1', call_id: 'call_1' })
    const end = parsed[4]!.event as { type: string; status: string; error: { message: string } }
    expect(end.status).toBe('failed')
    expect(end.error.message).toBe('lookup gave up')
  })

  it('nests a handoff target and an agent used as a tool', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 20),
      response('r1', 0.2, 1, 'a1', { toolCalls: [{ id: 'call_1', name: 'summarize', args: {} }] }),
      fn('f1', 'summarize', 1.1, 5, 'a1'),
      agent('a2', 'Summarizer', 1.2, 4.9, 'f1'),
      response('r2', 1.3, 4, 'a2', { text: 'short version' }),
      span({ id: 'h1', type: 'handoff', start: 5.1, end: 5.2, parent: 'a1', from_agent: 'Triage', to_agent: 'Refund' }),
      agent('a3', 'Refund', 5.3, 19),
      response('r3', 5.4, 8, 'a3', { text: 'refunded' }),
    ])
    const byId = new Map(parsed.map((p) => [(p.event as { id: string }).id, p.event as Record<string, unknown>]))
    // The sub-agent's call hangs off the tool that ran it, and its model call off the sub-agent.
    expect(byId.get('a2')).toMatchObject({ type: 'agent.call', parent_id: 'f1', agent: { name: 'Summarizer' }, output: 'short version' })
    expect(byId.get('r2')).toMatchObject({ type: 'model.call', parent_id: 'a2', step: 1 })
    expect(byId.get('h1')).toMatchObject({ type: 'log', message: 'Handoff: Triage → Refund' })
    // The handoff target is a sub-agent of the run, and counts its own steps.
    expect(byId.get('a3')).toMatchObject({ type: 'agent.call', agent: { name: 'Refund' } })
    expect(byId.get('a3')!.parent_id).toBeUndefined()
    expect(byId.get('r3')).toMatchObject({ parent_id: 'a3', step: 1 })
    // The run's answer is the last thing the agent that finished it said.
    expect((parsed[parsed.length - 1]!.event as { type: string; output: unknown })).toMatchObject({ type: 'run.end', output: 'refunded' })
  })

  it('reads approvals from custom spans and links the tool call they cleared', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Refund', 0, 20),
      response('r1', 0.2, 1, 'a1', { toolCalls: [{ id: 'call_1', name: 'issue_refund', args: { amount: 429 } }] }),
      span({
        id: 'c1',
        type: 'custom',
        start: 1.1,
        end: 1.2,
        parent: 'a1',
        name: 'trailview.approval.request',
        data: { approval_id: 'ap_1', action: 'issue_refund', summary: 'Refund US$429', policy: 'over_200' },
      }),
      span({
        id: 'c2',
        type: 'custom',
        start: 9,
        end: 9.1,
        parent: 'a1',
        name: 'trailview.approval.decision',
        data: { approval_id: 'ap_1', decision: 'approved', by: { kind: 'human', name: 'd' }, reason: 'photos match' },
      }),
      fn('f1', 'issue_refund', 9.2, 10, 'a1'),
    ])
    const request = parsed[2]!.event as Record<string, unknown>
    expect(request).toMatchObject({ type: 'approval.request', approval_id: 'ap_1', action: 'issue_refund', summary: 'Refund US$429', policy: 'over_200', call_id: 'call_1' })
    expect(parsed[3]!.event).toMatchObject({ type: 'approval.decision', decision: 'approved', by: { kind: 'human', name: 'd' }, reason: 'photos match' })
    expect(parsed[4]!.event).toMatchObject({ type: 'tool.call', tool: 'issue_refund', approval_id: 'ap_1' })
    const [run] = buildRuns(parsed)
    expect(run!.totals.approvals).toBe(1)
    expect(run!.totals.waitMs).toBe(7900)
  })

  it('keeps a rejected approval off the tool call', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Refund', 0, 20),
      response('r1', 0.2, 1, 'a1', { toolCalls: [{ id: 'call_1', name: 'issue_refund', args: {} }] }),
      span({ id: 'c1', type: 'custom', start: 1.1, end: 1.2, parent: 'a1', name: 'trailview.approval.request', data: { approval_id: 'ap_1', action: 'issue_refund', summary: 'Refund US$429' } }),
      span({ id: 'c2', type: 'custom', start: 3, end: 3.1, parent: 'a1', name: 'trailview.approval.decision', data: { approval_id: 'ap_1', decision: 'rejected', by: { kind: 'policy' } } }),
      response('r2', 3.2, 5, 'a1', { text: 'asking a person instead' }),
    ])
    const [run] = buildRuns(parsed)
    expect(run!.totals.rejections).toBe(1)
    expect(run!.totals.toolCalls).toBe(0)
  })

  it('shows a tripped guardrail as an error and a passing one as a log', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 10),
      span({ id: 'g1', type: 'guardrail', start: 0.1, end: 0.2, parent: 'a1', name: 'pii', triggered: false }),
      response('r1', 0.3, 2, 'a1', { text: 'here is the answer' }),
      span({ id: 'g2', type: 'guardrail', start: 2.1, end: 2.2, parent: 'a1', name: 'no_promises', triggered: true }),
    ])
    expect(parsed[1]!.event).toMatchObject({ type: 'log', level: 'info', message: 'Guardrail "pii" passed' })
    expect(parsed[3]!.event).toMatchObject({ type: 'error', error: { type: 'guardrail_tripwire', message: 'Guardrail "no_promises" triggered' } })
  })

  it('logs an MCP tool listing and keeps an unknown span type as a generic row', () => {
    const { events: parsed, issues } = events([
      trace(),
      agent('a1', 'Triage', 0, 10),
      span({ id: 'm1', type: 'mcp_tools', start: 0.1, end: 0.3, parent: 'a1', server: 'orders', result: ['lookup_order', 'lookup_shipment'] }),
      span({ id: 's1', type: 'transcription', start: 0.4, end: 1, parent: 'a1', model: 'whisper-1', output: 'hello' }),
    ])
    expect(parsed[1]!.event).toMatchObject({ type: 'log', message: 'Listed 2 tools from orders' })
    expect(parsed[2]!.event).toMatchObject({ type: 'openai.transcription', attrs: { model: 'whisper-1', output: 'hello' } })
    // A type the viewer does not know is kept, with a warning.
    expect(issues).toEqual([{ line: 1, severity: 'warning', message: 'Unknown event type "openai.transcription", shown as a generic row' }])
  })

  it('shows a span that never ended as an unfinished call, and no run end', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, undefined),
      response('r1', 0.2, 1, 'a1', { toolCalls: [{ id: 'call_1', name: 'lookup', args: {} }] }),
      fn('f1', 'lookup', 1.1, undefined, 'a1'),
    ])
    expect(parsed.map((p) => (p.event as { type: string }).type)).toEqual(['run.start', 'model.call', 'tool.start'])
    expect(parsed[2]!.event).toMatchObject({ type: 'tool.start', tool: 'lookup', call_id: 'call_1' })
  })

  it('keeps the finished copy of a span written at its start and its end', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 5),
      response('r1', 0.2, undefined, 'a1'),
      response('r1', 0.2, 2, 'a1', { text: 'done', usage: { input_tokens: 10, output_tokens: 2 } }),
    ])
    expect(parsed[1]!.event).toMatchObject({ type: 'model.call', output: { text: 'done' } })
  })

  it('reads one span per line and a paged response from the traces API', () => {
    const lines = [trace(), agent('a1', 'Triage', 0, 5), response('r1', 0.2, 2, 'a1', { text: 'hi' })].map((o) => JSON.stringify(o)).join('\n')
    expect(parseLog(lines).format).toBe('openai-agents')
    expect(parseLog(lines).events).toHaveLength(3)
    const paged = JSON.stringify({ data: [trace(), agent('a1', 'Triage', 0, 5), response('r1', 0.2, 2, 'a1', { text: 'hi' })], has_more: false })
    expect(parseOpenAiAgents(paged).events).toHaveLength(3)
  })

  it('splits two traces in one file into two runs', () => {
    const { events: parsed } = events([
      trace(),
      agent('a1', 'Triage', 0, 5),
      response('r1', 0.2, 2, 'a1', { text: 'one' }),
      { ...trace({ id: 'trace_2', workflow_name: 'support' }) },
      { ...agent('a2', 'Triage', 10, 15), trace_id: 'trace_2' },
      { ...response('r2', 10.2, 12, 'a2', { text: 'two' }), trace_id: 'trace_2' },
    ])
    expect(buildRuns(parsed).map((r) => r.id)).toEqual(['trace_1', 'trace_2'])
  })

  it('reports a span it cannot read and keeps the rest', () => {
    const { events: parsed, issues } = events([
      trace(),
      agent('a1', 'Triage', 0, 5),
      { object: 'trace.span', id: 'bad', trace_id: 'trace_1', started_at: null, span_data: { type: 'response' } },
      response('r1', 0.2, 2, 'a1', { text: 'hi' }),
    ])
    expect(issues).toEqual([{ line: 1, severity: 'error', message: 'Span "bad" is missing id, trace_id, started_at or span_data.type' }])
    expect(parsed.map((p) => (p.event as { type: string }).type)).toEqual(['run.start', 'model.call', 'run.end'])
  })

  it('reports a file with no spans', () => {
    expect(parseOpenAiAgents('[]').issues).toEqual([{ line: 1, severity: 'error', message: 'No OpenAI Agents SDK spans found' }])
  })

  it('reports a line that is not JSON', () => {
    const { issues } = parseOpenAiAgents(`${JSON.stringify(agent('a1', 'Triage', 0, 1))}\nnot json`)
    expect(issues[0]).toMatchObject({ line: 2, severity: 'error' })
  })
})

describe('the bundled sample', () => {
  it('is detected and parses without errors', () => {
    const { format, issues } = parseLog(sample)
    expect(format).toBe('openai-agents')
    expect(issues).toEqual([])
  })

  it('shows the handoff, the nested summarizer, the retry and the approval', () => {
    const [run] = buildRuns(parseLog(sample).events)
    expect(run!.status).toBe('succeeded')
    expect(run!.totals).toMatchObject({ modelCalls: 8, toolCalls: 3, retries: 1, approvals: 1, rejections: 0 })
    // Cost comes from the price table, because the SDK logs no cost.
    expect(run!.totals.costEstimated).toBe(true)
    // Two levels of nesting: the summarizer's own model call sits under its agent.call.
    expect(Math.max(...run!.items.map((i) => i.depth ?? 0))).toBe(2)
    const labels = run!.items.map((i) => {
      const event = i.events[0]!.event as Record<string, unknown>
      return `${event.type}:${event.model ?? event.tool ?? (event.agent as { name?: string } | undefined)?.name ?? ''}`
    })
    expect(labels).toContain('agent.call:Refund agent')
    expect(labels).toContain('agent.call:Thread summarizer')
  })
})
