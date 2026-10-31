import { SCHEMA_VERSION } from '../schema/events.ts'
import { validateEvents, type EventRecord, type ParseIssue, type ParseResult } from './jsonl.ts'

// Adapter from OpenAI Agents SDK traces to Trailview events. The SDK has no
// export file of its own, so this reads the objects its trace.export() and
// span.export() return: one per line, as a JSON array, or as {"data": [...]}.
// See docs/schema.md for the mapping and a TracingProcessor that writes them.

interface RawSpan {
  object?: unknown
  id?: unknown
  trace_id?: unknown
  parent_id?: unknown
  started_at?: unknown
  ended_at?: unknown
  span_data?: unknown
  error?: unknown
}

interface Span {
  line: number
  id: string
  traceId: string
  parentId?: string
  type: string
  data: Record<string, unknown>
  startMs: number
  endMs: number
  // Written when the span started and never again: the process stopped first.
  open: boolean
  error?: { message?: unknown; data?: unknown }
}

interface Trace {
  workflowName?: string
  groupId?: string
  metadata: Record<string, unknown>
}

interface ToolCall {
  id: string
  name: string
  input?: unknown
}

interface ModelOutput {
  text?: string
  tool_calls?: ToolCall[]
}

// Per agent: its own step count, retry tracking and tool calls not yet run.
interface Scope {
  step: number
  lastModel?: { id: string; error: boolean; model: string }
  lastTool?: { id: string; name: string; error: boolean; attempt: number; callId?: string }
  pendingCalls: ToolCall[]
  // Tool name to the approval that cleared its next call.
  approved: Map<string, string>
  lastText?: string
}

// The SDK's default workflow name says nothing, so the first agent's name is used instead.
const DEFAULT_WORKFLOW = 'Agent workflow'

export function isOpenAiAgentsJson(text: string): boolean {
  const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 4000)
  return (head.startsWith('[') || head.startsWith('{')) && /"object"\s*:\s*"trace(\.span)?"/.test(head)
}

export function parseOpenAiAgents(text: string): ParseResult {
  const issues: ParseIssue[] = []
  const { traces, spans } = readItems(text, issues)
  if (spans.length === 0 && issues.length === 0) {
    issues.push({ line: 1, severity: 'error', message: 'No OpenAI Agents SDK spans found' })
  }

  const byTrace = new Map<string, Span[]>()
  for (const span of spans) {
    const list = byTrace.get(span.traceId) ?? []
    list.push(span)
    byTrace.set(span.traceId, list)
  }

  const records: EventRecord[] = []
  for (const [traceId, traceSpans] of byTrace) records.push(...traceToEvents(traceId, traceSpans, traces.get(traceId)))
  return validateEvents(records, issues)
}

function readItems(text: string, issues: ParseIssue[]): { traces: Map<string, Trace>; spans: Span[] } {
  const body = text.replace(/^\uFEFF/, '')
  const docs: { line: number; value: unknown }[] = []
  try {
    docs.push({ line: 1, value: JSON.parse(body) })
  } catch {
    body.split(/\r?\n/).forEach((raw, index) => {
      if (raw.trim() === '') return
      try {
        docs.push({ line: index + 1, value: JSON.parse(raw) })
      } catch (err) {
        issues.push({ line: index + 1, severity: 'error', message: `Not valid JSON: ${(err as Error).message}` })
      }
    })
  }

  const traces = new Map<string, Trace>()
  // A span written at start and again at end keeps the finished copy.
  const spans = new Map<string, Span>()
  const visit = (value: unknown, line: number) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, line)
      return
    }
    if (!isObject(value)) {
      issues.push({ line, severity: 'error', message: 'Expected a trace or span object' })
      return
    }
    if (value.object === undefined && Array.isArray(value.data)) {
      visit(value.data, line)
      return
    }
    if (value.object === 'trace') {
      const id = str(value.id)
      if (id) traces.set(id, { workflowName: str(value.workflow_name), groupId: str(value.group_id), metadata: isObject(value.metadata) ? value.metadata : {} })
      return
    }
    if (value.object !== 'trace.span') {
      issues.push({ line, severity: 'warning', message: `Skipped an object of type "${str(value.object) ?? '?'}"` })
      return
    }
    const span = toSpan(value as RawSpan, line)
    if (!span) {
      issues.push({ line, severity: 'error', message: `Span "${str(value.id) ?? '?'}" is missing id, trace_id, started_at or span_data.type` })
      return
    }
    const seen = spans.get(span.id)
    // The last finished copy wins; a start-only copy never replaces a finished one.
    if (!seen || !span.open) spans.set(span.id, span)
  }
  for (const { line, value } of docs) visit(value, line)
  return { traces, spans: [...spans.values()] }
}

function toSpan(raw: RawSpan, line: number): Span | undefined {
  const id = str(raw.id)
  const traceId = str(raw.trace_id)
  const startMs = timeMs(raw.started_at)
  const data = isObject(raw.span_data) ? raw.span_data : undefined
  const type = str(data?.type)
  if (!id || !traceId || startMs === undefined || !data || !type) return undefined
  const end = timeMs(raw.ended_at)
  return {
    line,
    id,
    traceId,
    parentId: str(raw.parent_id),
    type,
    data,
    startMs,
    endMs: Math.max(end ?? startMs, startMs),
    open: end === undefined,
    ...(isObject(raw.error) && { error: raw.error }),
  }
}

function traceToEvents(traceId: string, spans: Span[], trace: Trace | undefined): EventRecord[] {
  spans.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs)
  const byId = new Map(spans.map((s) => [s.id, s]))
  const parentOf = (span: Span) => (span.parentId ? byId.get(span.parentId) : undefined)

  // The first top-level agent is the run; later top-level agents are handoff targets.
  const isTopLevel = (span: Span) => {
    for (let p = parentOf(span), seen = 0; p && seen < spans.length; p = parentOf(p), seen++) {
      if (p.type === 'agent' || p.type === 'function') return false
    }
    return true
  }
  const topAgents = spans.filter((s) => s.type === 'agent' && isTopLevel(s))
  const root = topAgents[0]

  // Events nest under the closest agent (other than the run's) or tool that contains them.
  const containerOf = (span: Span): Span | undefined => {
    for (let p = parentOf(span), seen = 0; p && seen < spans.length; p = parentOf(p), seen++) {
      if (p === root) return undefined
      if (p.type === 'function' || (p.type === 'agent' && !p.open)) return p
    }
    return undefined
  }

  const out: EventRecord[] = []
  const add = (line: number, value: Record<string, unknown>) => out.push({ line, value: { run_id: traceId, ...value } })
  const addCall = (span: Span, value: Record<string, unknown>) => add(span.line, span.open ? asStart(value) : value)

  const scopes = new Map<string, Scope>()
  const scopeOf = (key: string) => {
    let scope = scopes.get(key)
    if (!scope) scopes.set(key, (scope = { step: 0, pendingCalls: [], approved: new Map() }))
    return scope
  }

  const first = spans[0]!
  const startMs = root?.startMs ?? first.startMs
  const workflow = trace?.workflowName && trace.workflowName !== DEFAULT_WORKFLOW ? trace.workflowName : undefined
  const runInput = firstUserInput(spans)
  add((root ?? first).line, {
    type: 'run.start',
    v: SCHEMA_VERSION,
    id: `${traceId}-start`,
    ts: iso(startMs),
    agent: { name: workflow ?? str(root?.data.name) ?? trace?.workflowName ?? 'agent' },
    ...(runInput !== undefined && { input: runInput }),
    attrs: { source: 'openai-agents', trace_id: traceId, ...(trace?.groupId && { group_id: trace.groupId }), ...trace?.metadata },
  })

  // Nested agents report their output on their agent.call, filled in once their work is read.
  const agentCalls = new Map<string, Record<string, unknown>>()

  for (const span of spans) {
    if (span === root) continue
    const container = containerOf(span)
    const scope = scopeOf(container?.id ?? 'root')
    const nested = container ? { parent_id: container.id } : {}
    const common = { id: span.id, ts: iso(span.startMs), ...nested }
    const duration_ms = Math.round(span.endMs - span.startMs)
    const step = Math.max(scope.step, 1)
    const error = span.error ? errorOf(span) : undefined

    switch (span.type) {
      case 'generation':
      case 'response': {
        const model = str(span.data.model) ?? 'unknown'
        const retry = scope.lastModel?.error && scope.lastModel.model === model ? scope.lastModel : undefined
        if (!retry) scope.step += 1
        const output = span.type === 'generation' ? generationOutput(span.data.output) : responseOutput(span.data.output)
        const usage = usageOf(span.data.usage)
        addCall(span, {
          type: 'model.call',
          ...common,
          step: scope.step,
          provider: providerOf(model),
          model,
          duration_ms,
          status: error ? 'error' : 'ok',
          ...(span.data.input !== undefined && span.data.input !== null && { input: span.data.input }),
          ...(output && { output }),
          ...(str(span.data.stop_reason) && { stop_reason: str(span.data.stop_reason) }),
          ...(usage && { usage }),
          ...(retry && { attempt: 2, retry_of: retry.id }),
          ...(error && { error }),
        })
        scope.lastModel = { id: span.id, error: !!error, model }
        scope.lastTool = undefined
        scope.pendingCalls = output?.tool_calls ? [...output.tool_calls] : []
        if (output?.text) scope.lastText = output.text
        break
      }

      case 'function': {
        const name = str(span.data.name) ?? 'tool'
        // A call after a failed call to the same tool, with no model call between, is its retry.
        const retry = scope.lastTool?.error && scope.lastTool.name === name ? scope.lastTool : undefined
        let callId = retry?.callId
        if (!callId) {
          const index = scope.pendingCalls.findIndex((c) => c.name === name)
          if (index >= 0) callId = scope.pendingCalls[index]!.id
        }
        scope.pendingCalls = scope.pendingCalls.filter((c) => c.id !== callId)
        const approvalId = scope.approved.get(name)
        scope.approved.delete(name)
        addCall(span, {
          type: 'tool.call',
          ...common,
          step,
          tool: name,
          ...(callId && { call_id: callId }),
          duration_ms,
          status: error ? 'error' : 'ok',
          ...(span.data.input != null && { input: json(span.data.input) }),
          ...(span.data.output != null && { output: json(span.data.output) }),
          ...(approvalId && { approval_id: approvalId }),
          ...(retry && { attempt: retry.attempt + 1, retry_of: retry.id }),
          ...(error && { error }),
          ...(isObject(span.data.mcp_data) && { attrs: { mcp: span.data.mcp_data } }),
        })
        scope.lastTool = { id: span.id, name, error: !!error, attempt: (retry?.attempt ?? 0) + 1, callId }
        scope.lastModel = undefined
        break
      }

      case 'agent': {
        // An agent that never finished is left out; its work shows at the top level.
        if (span.open) break
        const parent = parentOf(span)
        const value: Record<string, unknown> = {
          type: 'agent.call',
          ...common,
          step,
          agent: { name: str(span.data.name) ?? 'agent' },
          duration_ms,
          status: error ? 'error' : 'ok',
          ...(parent?.type === 'function' && parent.data.input != null && { input: json(parent.data.input) }),
          ...(error && { error }),
        }
        add(span.line, value)
        // add() copies the value, so the copy is what a later output is written to.
        agentCalls.set(span.id, out[out.length - 1]!.value as Record<string, unknown>)
        break
      }

      case 'handoff': {
        const from = str(span.data.from_agent) ?? '?'
        const to = str(span.data.to_agent) ?? '?'
        add(span.line, { type: 'log', ...common, step, level: 'info', message: `Handoff: ${from} → ${to}`, attrs: { from_agent: from, to_agent: to } })
        break
      }

      case 'guardrail': {
        const name = str(span.data.name) ?? 'guardrail'
        if (span.data.triggered === true) {
          add(span.line, { type: 'error', ...common, step, error: { type: 'guardrail_tripwire', message: `Guardrail "${name}" triggered` }, attrs: { guardrail: name } })
        } else {
          add(span.line, { type: 'log', ...common, step, level: 'info', message: `Guardrail "${name}" passed`, attrs: { guardrail: name } })
        }
        break
      }

      case 'mcp_tools': {
        const server = str(span.data.server) ?? 'MCP server'
        const tools = Array.isArray(span.data.result) ? span.data.result : []
        add(span.line, {
          type: 'log',
          ...common,
          step,
          level: error ? 'warn' : 'info',
          message: error ? `Listing tools from ${server} failed: ${error.message}` : `Listed ${tools.length} tools from ${server}`,
          attrs: { server, tools },
        })
        break
      }

      case 'custom': {
        const approval = approvalOf(span, traceId, step)
        if (approval) {
          if (approval.type === 'approval.request' && !approval.call_id) {
            const call = scope.pendingCalls.find((c) => c.name === approval.action)
            if (call) approval.call_id = call.id
          }
          if (approval.type === 'approval.decision' && approval.decision === 'approved') {
            const request = out.find((r) => (r.value as Record<string, unknown>).approval_id === approval.approval_id && (r.value as Record<string, unknown>).type === 'approval.request')
            const action = request && str((request.value as Record<string, unknown>).action)
            if (action) scope.approved.set(action, approval.approval_id)
          }
          add(span.line, { ...approval, ...nested })
          break
        }
        add(span.line, { type: 'openai.custom', ...common, ...(scope.step > 0 && { step: scope.step }), attrs: { name: str(span.data.name), data: span.data.data, duration_ms } })
        break
      }

      default:
        // Transcription, speech and anything newer are kept as generic rows.
        add(span.line, { type: `openai.${span.type}`, ...common, ...(scope.step > 0 && { step: scope.step }), attrs: { ...span.data, duration_ms, ...(error && { error }) } })
    }
  }

  for (const [id, value] of agentCalls) {
    const text = scopes.get(id)?.lastText
    if (text) value.output = text
  }

  // A top-level agent still running means the run has not ended.
  if (topAgents.some((a) => a.open)) return out
  const failed = [...topAgents].reverse().find((a) => a.error)
  const last = topAgents[topAgents.length - 1]
  const output = last && last !== root ? scopes.get(last.id)?.lastText : scopes.get('root')?.lastText
  const endMs = Math.max(...spans.map((s) => s.endMs))
  add((root ?? first).line, {
    type: 'run.end',
    id: `${traceId}-end`,
    ts: iso(endMs),
    status: failed ? 'failed' : 'succeeded',
    ...(output !== undefined && { output }),
    ...(failed && { error: errorOf(failed) }),
  })
  return out
}

const START_FIELDS = ['type', 'run_id', 'id', 'ts', 'step', 'parent_id', 'provider', 'model', 'tool', 'call_id', 'input', 'approval_id', 'attempt', 'retry_of']

function asStart(call: Record<string, unknown>): Record<string, unknown> {
  const start = Object.fromEntries(Object.entries(call).filter(([key]) => START_FIELDS.includes(key)))
  return { ...start, type: call.type === 'model.call' ? 'model.start' : 'tool.start' }
}

// Approvals have no Agents SDK span; Trailview reads custom spans named
// trailview.approval.request and trailview.approval.decision (see docs/schema.md).
function approvalOf(span: Span, runId: string, step: number): (Record<string, unknown> & { type: string; approval_id: string; action?: string; call_id?: string; decision?: string }) | undefined {
  const name = str(span.data.name)
  const data = isObject(span.data.data) ? span.data.data : {}
  const approvalId = str(data.approval_id)
  if (!approvalId) return undefined
  const base = { run_id: runId, id: span.id, ts: iso(span.startMs), step, approval_id: approvalId }
  if (name === 'trailview.approval.request') {
    return {
      ...base,
      type: 'approval.request',
      action: str(data.action) ?? 'action',
      summary: str(data.summary) ?? '',
      ...(str(data.call_id) && { call_id: str(data.call_id) }),
      ...(str(data.policy) && { policy: str(data.policy) }),
    }
  }
  if (name === 'trailview.approval.decision') {
    const by = isObject(data.by) ? data.by : {}
    return {
      ...base,
      type: 'approval.decision',
      decision: str(data.decision),
      by: { kind: str(by.kind) ?? 'human', ...(str(by.name) && { name: str(by.name) }) },
      ...(str(data.reason) && { reason: str(data.reason) }),
    }
  }
  return undefined
}

// Model names routed through LiteLLM look like "anthropic/claude-sonnet-5-5".
function providerOf(model: string): string {
  const slash = model.indexOf('/')
  if (slash > 0) return model.slice(0, slash)
  if (/claude/i.test(model)) return 'anthropic'
  if (/gemini/i.test(model)) return 'google'
  return 'openai'
}

// Generation spans hold Chat Completions messages.
function generationOutput(output: unknown): ModelOutput | undefined {
  const messages = Array.isArray(output) ? output : isObject(output) ? [output] : []
  const texts: string[] = []
  const toolCalls: ToolCall[] = []
  for (const message of messages) {
    if (!isObject(message)) continue
    const text = textOf(message.content)
    if (text) texts.push(text)
    if (!Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (!isObject(call)) continue
      const fn = isObject(call.function) ? call.function : call
      const name = str(fn.name)
      if (name) toolCalls.push({ id: str(call.id) ?? `call_${toolCalls.length + 1}`, name, input: json(fn.arguments) })
    }
  }
  return modelOutput(texts, toolCalls)
}

// Response spans hold Responses API output items (added by the TracingProcessor in docs/schema.md).
function responseOutput(output: unknown): ModelOutput | undefined {
  if (!Array.isArray(output)) return undefined
  const texts: string[] = []
  const toolCalls: ToolCall[] = []
  for (const item of output) {
    if (!isObject(item)) continue
    if (item.type === 'message') {
      const text = textOf(item.content)
      if (text) texts.push(text)
    } else if (item.type === 'function_call' && str(item.name)) {
      toolCalls.push({ id: str(item.call_id) ?? str(item.id) ?? `call_${toolCalls.length + 1}`, name: str(item.name)!, input: json(item.arguments) })
    }
  }
  return modelOutput(texts, toolCalls)
}

function modelOutput(texts: string[], toolCalls: ToolCall[]): ModelOutput | undefined {
  const text = texts.join('\n')
  if (!text && toolCalls.length === 0) return undefined
  return { ...(text && { text }), ...(toolCalls.length > 0 && { tool_calls: toolCalls }) }
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content || undefined
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part) => isObject(part) && typeof part.text === 'string' && (part.type === 'output_text' || part.type === 'text' || part.type === 'input_text'))
    .map((part) => (part as { text: string }).text)
    .join('\n')
  return text || undefined
}

// OpenAI counts cached tokens inside input_tokens; Trailview keeps them separate.
function usageOf(usage: unknown): Record<string, number> | undefined {
  if (!isObject(usage)) return undefined
  const input = num(usage.input_tokens) ?? num(usage.prompt_tokens)
  const output = num(usage.output_tokens) ?? num(usage.completion_tokens)
  if (input === undefined && output === undefined) return undefined
  const details = isObject(usage.input_tokens_details) ? usage.input_tokens_details : isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
  const cached = num(details.cached_tokens)
  return {
    input_tokens: Math.max(0, (input ?? 0) - (cached ?? 0)),
    output_tokens: output ?? 0,
    ...(cached && { cache_read_tokens: cached }),
  }
}

// The run's task: the first user message sent to a model.
function firstUserInput(spans: Span[]): unknown {
  for (const span of spans) {
    if (span.type !== 'generation' && span.type !== 'response') continue
    const input = span.data.input
    if (typeof input === 'string') return input
    if (!Array.isArray(input)) continue
    const user = input.find((m) => isObject(m) && m.role === 'user')
    if (isObject(user)) return textOf(user.content) ?? user.content
  }
  return undefined
}

// The SDK writes {message, data}; a failed tool puts the exception text in data.error.
function errorOf(span: Span): { type: string; message: string } {
  const data = isObject(span.error?.data) ? span.error.data : {}
  const message = str(data.error) ?? str(span.error?.message) ?? 'Span failed'
  const type = str(data.type) ?? `${span.type === 'function' ? 'tool' : span.type === 'generation' || span.type === 'response' ? 'model' : span.type}_error`
  return { type, message }
}

// The Python SDK writes ISO times with an offset; treat any without one as UTC.
function timeMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value === '') return undefined
  const withZone = /(?:Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value}Z`
  const ms = Date.parse(withZone)
  return Number.isNaN(ms) ? undefined : ms
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const iso = (ms: number) => new Date(ms).toISOString()
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
