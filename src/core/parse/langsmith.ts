import { SCHEMA_VERSION } from '../schema/events.ts'
import { validateEvents, type EventRecord, type ParseIssue, type ParseResult } from './jsonl.ts'

// Adapter from LangSmith run exports (LangChain and LangGraph traces) to
// Trailview events. Accepts what the LangSmith SDK's list_runs returns, dumped
// as a JSON array, as {"runs": [...]}, as one run with nested child_runs, or
// one run per line. See docs/schema.md for the mapping.

interface RawRun {
  id?: unknown
  trace_id?: unknown
  parent_run_id?: unknown
  name?: unknown
  run_type?: unknown
  start_time?: unknown
  end_time?: unknown
  status?: unknown
  error?: unknown
  inputs?: unknown
  outputs?: unknown
  extra?: { metadata?: Record<string, unknown>; invocation_params?: Record<string, unknown> } | null
  events?: unknown
  prompt_tokens?: unknown
  completion_tokens?: unknown
  total_cost?: unknown
  dotted_order?: unknown
  child_runs?: unknown
}

interface Run {
  line: number
  id: string
  traceId?: string
  parentId?: string
  name: string
  type: string
  startMs: number
  endMs: number
  error?: string
  raw: RawRun
}

// Plumbing run types: their model and tool calls are shown, the wrappers are not.
const STRUCTURAL_TYPES = new Set(['chain', 'prompt', 'parser'])

export function isLangSmithJson(text: string): boolean {
  const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 4000)
  return (head.startsWith('[') || head.startsWith('{')) && /"run_type"\s*:/.test(head) && /"start_time"\s*:/.test(head)
}

export function parseLangSmith(text: string): ParseResult {
  const issues: ParseIssue[] = []
  const runs = readRuns(text, issues)
  if (runs.length === 0 && issues.length === 0) {
    issues.push({ line: 1, severity: 'error', message: 'No LangSmith runs found' })
  }

  const byId = new Map(runs.map((r) => [r.id, r]))
  const byTrace = new Map<string, Run[]>()
  for (const run of runs) {
    const root = rootOf(run, byId)
    const key = run.traceId ?? root.traceId ?? root.id
    const list = byTrace.get(key) ?? []
    list.push(run)
    byTrace.set(key, list)
  }

  const records: EventRecord[] = []
  for (const [traceId, traceRuns] of byTrace) records.push(...traceToEvents(traceId, traceRuns))
  return validateEvents(records, issues)
}

function rootOf(run: Run, byId: Map<string, Run>): Run {
  let current = run
  const seen = new Set<string>()
  while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
    seen.add(current.id)
    current = byId.get(current.parentId)!
  }
  return current
}

function readRuns(text: string, issues: ParseIssue[]): Run[] {
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

  const runs: Run[] = []
  const visit = (value: unknown, line: number, parentId?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, line, parentId)
      return
    }
    if (!isObject(value)) {
      issues.push({ line, severity: 'error', message: 'Expected a LangSmith run object' })
      return
    }
    if (Array.isArray(value.runs) && value.run_type === undefined) {
      visit(value.runs, line)
      return
    }
    const raw = value as RawRun
    const run = toRun(raw, line, parentId)
    if (run) runs.push(run)
    else issues.push({ line, severity: 'error', message: `Run "${str(raw.name) ?? '?'}" is missing id, run_type or start_time` })
    if (Array.isArray(raw.child_runs)) visit(raw.child_runs, line, run?.id)
  }
  for (const { line, value } of docs) visit(value, line)
  return runs
}

function toRun(raw: RawRun, line: number, parentId?: string): Run | undefined {
  const id = str(raw.id)
  const type = str(raw.run_type)
  const startMs = timeMs(raw.start_time)
  if (!id || !type || startMs === undefined) return undefined
  const endMs = timeMs(raw.end_time) ?? startMs
  const error = str(raw.error) ?? (raw.status === 'error' ? 'Run failed' : undefined)
  return {
    line,
    id,
    traceId: str(raw.trace_id),
    parentId: str(raw.parent_run_id) ?? parentId,
    name: str(raw.name) ?? type,
    type,
    startMs,
    endMs: Math.max(endMs, startMs),
    ...(error && { error }),
    raw,
  }
}

function traceToEvents(traceId: string, runs: Run[]): EventRecord[] {
  runs.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs || order(a).localeCompare(order(b)))
  const ids = new Set(runs.map((r) => r.id))
  const root = runs.find((r) => !r.parentId || !ids.has(r.parentId))!
  const out: EventRecord[] = []
  const add = (line: number, value: Record<string, unknown>) => out.push({ line, value: { run_id: traceId, ...value } })
  const metadata = root.raw.extra?.metadata ?? {}

  add(root.line, {
    type: 'run.start',
    v: SCHEMA_VERSION,
    id: `${root.id}-start`,
    ts: iso(root.startMs),
    agent: { name: root.name, ...(versionOf(root.name, metadata) && { version: versionOf(root.name, metadata) }) },
    ...(root.raw.inputs !== undefined && { input: promptOf(root.raw.inputs) }),
    attrs: { source: 'langsmith', trace_id: traceId, root_run_id: root.id, ...(str(metadata.thread_id) && { thread_id: str(metadata.thread_id) }) },
  })

  // Errors are reported once, on the innermost run that failed.
  const failedChildOf = new Set<string>()
  for (const run of runs) if (run.error && run.parentId) failedChildOf.add(run.parentId)

  let step = 0
  let lastModel: { id: string; error: boolean; model: string } | undefined
  let lastTool: { id: string; name: string; error: boolean; attempt: number; callId?: string } | undefined
  let pendingCalls: { id: string; name: string }[] = []

  for (const run of runs) {
    if (run === root) continue
    // parent_run_id usually points at a LangGraph node, which is not shown, so it is not carried over.
    const common = { id: run.id, ts: iso(run.startMs) }
    const duration_ms = Math.round(run.endMs - run.startMs)
    const error = run.error ? errorInfo(run.error) : undefined

    if (run.type === 'llm') {
      const model = modelOf(run)
      const retry = lastModel?.error && lastModel.model === model ? lastModel : undefined
      if (!retry) step += 1
      const generation = generationOf(run.raw.outputs)
      const output = outputOf(generation)
      const cost = costOf(run.raw.total_cost)
      add(run.line, {
        type: 'model.call',
        ...common,
        step,
        provider: providerOf(run),
        model,
        duration_ms,
        status: run.error ? 'error' : 'ok',
        ...(run.raw.inputs !== undefined && { input: inputOf(run.raw.inputs) }),
        ...(output && { output }),
        ...(stopReasonOf(generation) && { stop_reason: stopReasonOf(generation) }),
        ...usageOf(run, generation),
        ...(cost !== undefined && { cost_usd: cost }),
        ...(retry && { attempt: 2, retry_of: retry.id }),
        ...(error && { error }),
      })
      lastModel = { id: run.id, error: !!run.error, model }
      lastTool = undefined
      pendingCalls = output?.tool_calls ? [...output.tool_calls] : []
      continue
    }

    if (run.type === 'tool') {
      // A tool call after a failed call to the same tool, with no model call between, is its retry.
      const retry = lastTool?.error && lastTool.name === run.name ? lastTool : undefined
      let callId = callIdOf(run) ?? retry?.callId
      if (!callId) {
        const index = pendingCalls.findIndex((c) => c.name === run.name)
        if (index >= 0) callId = pendingCalls[index]!.id
      }
      pendingCalls = pendingCalls.filter((c) => c.id !== callId)
      const approvals = approvalEvents(run, traceId, Math.max(step, 1))
      const decided = approvals.find((a) => a.type === 'approval.decision')
      add(run.line, {
        type: 'tool.call',
        ...common,
        step: Math.max(step, 1),
        tool: run.name,
        ...(callId && { call_id: callId }),
        duration_ms,
        status: run.error ? 'error' : 'ok',
        ...(run.raw.inputs !== undefined && { input: toolInputOf(run.raw.inputs) }),
        ...(run.raw.outputs != null && { output: toolOutputOf(run.raw.outputs) }),
        ...(decided && { approval_id: decided.approval_id }),
        ...(retry && { attempt: retry.attempt + 1, retry_of: retry.id }),
        ...(error && { error }),
      })
      for (const approval of approvals) add(run.line, { ...approval, ...(callId && approval.type === 'approval.request' && { call_id: callId }) })
      lastTool = { id: run.id, name: run.name, error: !!run.error, attempt: (retry?.attempt ?? 0) + 1, callId }
      lastModel = undefined
      continue
    }

    if (STRUCTURAL_TYPES.has(run.type)) {
      // A wrapper that failed on its own (not because a call inside it failed) becomes an error row.
      if (error && !failedChildOf.has(run.id)) {
        add(run.line, { type: 'error', ...common, ...(step > 0 && { step }), error, attrs: { run_name: run.name } })
      }
      continue
    }

    // Retrievers, embeddings and anything newer are kept as generic rows.
    add(run.line, {
      type: `langsmith.${run.type}`,
      ...common,
      ...(step > 0 && { step }),
      attrs: { name: run.name, duration_ms, ...(error && { error }), ...(run.raw.inputs !== undefined && { inputs: run.raw.inputs }), ...(run.raw.outputs != null && { outputs: run.raw.outputs }) },
    })
  }

  const output = outputTextOf(root.raw.outputs)
  add(root.line, {
    type: 'run.end',
    id: `${root.id}-end`,
    ts: iso(root.endMs),
    status: root.error ? 'failed' : 'succeeded',
    ...(output !== undefined && { output }),
    ...(root.error && { error: errorInfo(root.error) }),
  })
  return out
}

// Approvals have no LangSmith convention; Trailview reads run events named
// trailview.approval.request and trailview.approval.decision (see docs/schema.md).
function approvalEvents(run: Run, runId: string, step: number): (Record<string, unknown> & { type: string; approval_id: string })[] {
  const out: (Record<string, unknown> & { type: string; approval_id: string })[] = []
  const events = Array.isArray(run.raw.events) ? run.raw.events : []
  events.forEach((event: unknown, index) => {
    if (!isObject(event)) return
    const kwargs = isObject(event.kwargs) ? event.kwargs : {}
    const approvalId = str(kwargs.approval_id)
    if (!approvalId) return
    const base = { run_id: runId, id: `${run.id}-ap${index + 1}`, ts: iso(timeMs(event.time) ?? run.startMs), step, approval_id: approvalId }
    if (event.name === 'trailview.approval.request') {
      out.push({
        ...base,
        type: 'approval.request',
        action: str(kwargs.action) ?? run.name,
        summary: str(kwargs.summary) ?? '',
        ...(str(kwargs.policy) && { policy: str(kwargs.policy) }),
      })
    } else if (event.name === 'trailview.approval.decision') {
      const by = isObject(kwargs.by) ? kwargs.by : {}
      out.push({
        ...base,
        type: 'approval.decision',
        decision: str(kwargs.decision),
        by: { kind: str(by.kind) ?? 'human', ...(str(by.name) && { name: str(by.name) }) },
        ...(str(kwargs.reason) && { reason: str(kwargs.reason) }),
      })
    }
  })
  return out
}

// revision_id is free text; "my-agent@1.3.0" on a run named my-agent becomes "1.3.0".
function versionOf(name: string, metadata: Record<string, unknown>): string | undefined {
  const revision = str(metadata.revision_id)
  return revision?.startsWith(`${name}@`) ? revision.slice(name.length + 1) : revision
}

function modelOf(run: Run): string {
  const meta = run.raw.extra?.metadata ?? {}
  const params = run.raw.extra?.invocation_params ?? {}
  const llmOutput = isObject(run.raw.outputs) && isObject(run.raw.outputs.llm_output) ? run.raw.outputs.llm_output : {}
  return str(meta.ls_model_name) ?? str(params.model) ?? str(params.model_name) ?? str(llmOutput.model_name) ?? str(llmOutput.model) ?? run.name
}

const PROVIDER_BY_CLASS: [RegExp, string][] = [
  [/anthropic/i, 'anthropic'],
  [/openai/i, 'openai'],
  [/bedrock/i, 'aws_bedrock'],
  [/vertex|google|gemini/i, 'google'],
  [/mistral/i, 'mistral'],
  [/ollama/i, 'ollama'],
]

function providerOf(run: Run): string {
  const meta = run.raw.extra?.metadata ?? {}
  const explicit = str(meta.ls_provider)
  if (explicit) return explicit
  return PROVIDER_BY_CLASS.find(([pattern]) => pattern.test(run.name))?.[1] ?? 'unknown'
}

type Generation = { text?: unknown; message?: unknown; generation_info?: unknown }
type MessageFields = { content?: unknown; tool_calls?: unknown; usage_metadata?: unknown; response_metadata?: unknown; type?: unknown; role?: unknown }

function generationOf(outputs: unknown): Generation | undefined {
  if (!isObject(outputs)) return undefined
  const generations = outputs.generations
  const first = Array.isArray(generations) ? (Array.isArray(generations[0]) ? generations[0][0] : generations[0]) : undefined
  return isObject(first) ? (first as Generation) : undefined
}

// LangChain serialises messages as {lc, type, id, kwargs}; plain dicts also occur.
function messageFields(value: unknown): MessageFields | undefined {
  if (!isObject(value)) return undefined
  if (isObject(value.kwargs) && value.lc !== undefined) return { ...(value.kwargs as MessageFields), type: messageType(value) }
  return value as MessageFields
}

function messageType(value: Record<string, unknown>): string | undefined {
  const id = Array.isArray(value.id) ? str(value.id[value.id.length - 1]) : undefined
  return id?.replace(/(Message|MessageChunk)$/, '').toLowerCase()
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as { text: string }).text)
    .join('\n')
  return text || undefined
}

function outputOf(generation: Generation | undefined): { text?: string; tool_calls?: { id: string; name: string; input?: unknown }[] } | undefined {
  if (!generation) return undefined
  const message = messageFields(generation.message)
  const text = textOf(message?.content) ?? str(generation.text)
  const raw = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  const toolCalls = raw
    .filter((c): c is Record<string, unknown> => isObject(c) && !!str(c.name))
    .map((c, i) => ({ id: str(c.id) ?? `call_${i + 1}`, name: str(c.name)!, input: c.args ?? c.input }))
  if (!text && toolCalls.length === 0) return undefined
  return { ...(text && { text }), ...(toolCalls.length > 0 && { tool_calls: toolCalls }) }
}

function stopReasonOf(generation: Generation | undefined): string | undefined {
  const message = messageFields(generation?.message)
  const meta = isObject(message?.response_metadata) ? message.response_metadata : {}
  const info = isObject(generation?.generation_info) ? generation.generation_info : {}
  return str(meta.stop_reason) ?? str(meta.finish_reason) ?? str(info.finish_reason) ?? str(info.stop_reason)
}

function usageOf(run: Run, generation: Generation | undefined): { usage?: Record<string, number> } {
  const message = messageFields(generation?.message)
  const meta = isObject(message?.usage_metadata) ? message.usage_metadata : undefined
  if (meta) {
    const details = isObject(meta.input_token_details) ? meta.input_token_details : {}
    const cacheRead = num(details.cache_read)
    const cacheWrite = num(details.cache_creation)
    // LangChain counts cached tokens inside input_tokens; Trailview keeps them separate.
    const input = Math.max(0, (num(meta.input_tokens) ?? 0) - (cacheRead ?? 0) - (cacheWrite ?? 0))
    return {
      usage: {
        input_tokens: input,
        output_tokens: num(meta.output_tokens) ?? 0,
        ...(cacheRead !== undefined && { cache_read_tokens: cacheRead }),
        ...(cacheWrite !== undefined && { cache_write_tokens: cacheWrite }),
      },
    }
  }
  const llmOutput = isObject(run.raw.outputs) && isObject(run.raw.outputs.llm_output) ? run.raw.outputs.llm_output : {}
  const tokenUsage = isObject(llmOutput.token_usage) ? llmOutput.token_usage : isObject(llmOutput.usage) ? llmOutput.usage : {}
  const input = num(tokenUsage.prompt_tokens) ?? num(tokenUsage.input_tokens) ?? num(run.raw.prompt_tokens)
  const output = num(tokenUsage.completion_tokens) ?? num(tokenUsage.output_tokens) ?? num(run.raw.completion_tokens)
  // LangSmith reports 0 tokens for calls that failed before the provider billed anything.
  if (!input && !output) return {}
  return { usage: { input_tokens: input ?? 0, output_tokens: output ?? 0 } }
}

// Chat model inputs arrive as [[message, ...]] (one list per prompt); show the first prompt as {role, content}.
function inputOf(inputs: unknown): unknown {
  if (!isObject(inputs)) return inputs
  let list = inputs.messages
  if (Array.isArray(list) && Array.isArray(list[0])) list = list[0]
  if (!Array.isArray(list)) return inputs.prompts ?? inputs
  return list.map((m) => {
    const fields = messageFields(m)
    if (!fields) return m
    const role = str(fields.role) ?? roleOf(str(fields.type))
    const toolCalls = Array.isArray(fields.tool_calls) && fields.tool_calls.length > 0 ? { tool_calls: fields.tool_calls } : {}
    return { role, content: textOf(fields.content) ?? fields.content, ...toolCalls }
  })
}

function roleOf(type: string | undefined): string {
  if (type === 'human') return 'user'
  if (type === 'ai') return 'assistant'
  return type ?? 'unknown'
}

// The run's input as plain text when it is a single question, else the inputs as logged.
function promptOf(inputs: unknown): unknown {
  if (!isObject(inputs)) return inputs
  const keys = Object.keys(inputs)
  if (keys.length === 1 && typeof inputs[keys[0]!] === 'string') return inputs[keys[0]!]
  const messages = inputOf(inputs)
  if (Array.isArray(messages) && messages.length === 1 && isObject(messages[0]) && messages[0].role === 'user' && typeof messages[0].content === 'string') {
    return messages[0].content
  }
  return inputs
}

// The run's final answer: a single string output, or the last AI message's text.
function outputTextOf(outputs: unknown): unknown {
  if (outputs == null) return undefined
  if (!isObject(outputs)) return outputs
  const keys = Object.keys(outputs)
  if (keys.length === 1 && typeof outputs[keys[0]!] === 'string') return outputs[keys[0]!]
  if (Array.isArray(outputs.messages)) {
    for (let i = outputs.messages.length - 1; i >= 0; i--) {
      const fields = messageFields(outputs.messages[i])
      const role = str(fields?.role) ?? roleOf(str(fields?.type))
      const text = textOf(fields?.content)
      if (role === 'assistant' && text) return text
    }
  }
  return outputs
}

function toolInputOf(inputs: unknown): unknown {
  if (isObject(inputs) && Object.keys(inputs).length === 1 && 'input' in inputs) return json(inputs.input)
  return inputs
}

function toolOutputOf(outputs: unknown): unknown {
  if (!isObject(outputs) || !('output' in outputs)) return outputs
  const fields = messageFields(outputs.output)
  if (fields && 'content' in fields) return json(textOf(fields.content) ?? fields.content)
  return json(outputs.output)
}

function callIdOf(run: Run): string | undefined {
  const outputs = run.raw.outputs
  const fields = isObject(outputs) ? messageFields(outputs.output) : undefined
  const fromOutput = fields ? str((fields as Record<string, unknown>).tool_call_id) : undefined
  const inputs = isObject(run.raw.inputs) ? run.raw.inputs : {}
  return fromOutput ?? str(inputs.tool_call_id) ?? str(run.raw.extra?.metadata?.tool_call_id)
}

// LangSmith stores the exception as "Type('message')" or "Type: message", often followed by a traceback.
function errorInfo(text: string): { type: string; message: string } {
  const firstLine = text.split('\n')[0]!.trim()
  const call = /^([A-Za-z_][\w.]*)\((['"])([\s\S]*)\2\)$/.exec(firstLine)
  if (call) return { type: call[1]!, message: call[3]! }
  const colon = /^([A-Za-z_][\w.]*): (.*)$/.exec(firstLine)
  if (colon) return { type: colon[1]!, message: colon[2]! }
  return { type: 'error', message: firstLine || 'Run failed' }
}

// LangSmith writes UTC times without an offset; treat those as UTC.
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

// LangSmith reports total_cost as a number or a decimal string.
function costOf(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

const order = (run: Run) => str(run.raw.dotted_order) ?? ''
const iso = (ms: number) => new Date(ms).toISOString()
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
