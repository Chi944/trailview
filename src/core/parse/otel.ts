import { SCHEMA_VERSION } from '../schema/events.ts'
import { validateEvents, type EventRecord, type ParseIssue, type ParseResult } from './jsonl.ts'

// Adapter from OpenTelemetry traces in OTLP/JSON (the collector's file exporter
// format) to Trailview events. Only spans that follow the GenAI semantic
// conventions are used; see docs/schema.md for the mapping.

type AnyValue = {
  stringValue?: string
  boolValue?: boolean
  intValue?: string | number
  doubleValue?: number
  arrayValue?: { values?: AnyValue[] }
  kvlistValue?: { values?: KeyValue[] }
  bytesValue?: string
}
type KeyValue = { key: string; value?: AnyValue }

interface OtlpSpan {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  name?: string
  startTimeUnixNano?: string | number
  endTimeUnixNano?: string | number
  attributes?: KeyValue[]
  events?: { timeUnixNano?: string | number; name?: string; attributes?: KeyValue[] }[]
  status?: { code?: number | string; message?: string }
}

interface Span {
  line: number
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startMs: number
  endMs: number
  attrs: Record<string, unknown>
  resource: Record<string, unknown>
  events: { timeMs: number; name: string; attrs: Record<string, unknown> }[]
  error: boolean
  statusMessage?: string
}

const MODEL_OPERATIONS = new Set(['chat', 'text_completion', 'generate_content'])

// True when the text looks like OTLP/JSON: one export request per line, or a single document.
export function isOtlpJson(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').trimStart()
  return first.startsWith('{') && /"resourceSpans"\s*:/.test(first.slice(0, 2000))
}

export function parseOtlp(text: string): ParseResult {
  const issues: ParseIssue[] = []
  const spans = readSpans(text, issues)

  const genAi = spans.filter((s) => typeof s.attrs['gen_ai.operation.name'] === 'string')
  const skipped = spans.length - genAi.length
  if (skipped > 0) {
    issues.push({
      line: 1,
      severity: 'warning',
      message: `${skipped} span(s) without gen_ai.operation.name were skipped`,
    })
  }
  if (spans.length > 0 && genAi.length === 0) {
    issues.push({ line: 1, severity: 'error', message: 'No GenAI spans found (none set gen_ai.operation.name)' })
  }

  const byTrace = new Map<string, Span[]>()
  for (const span of genAi) {
    const list = byTrace.get(span.traceId) ?? []
    list.push(span)
    byTrace.set(span.traceId, list)
  }

  const records: EventRecord[] = []
  for (const traceSpans of byTrace.values()) records.push(...traceToEvents(traceSpans))
  return validateEvents(records, issues)
}

function readSpans(text: string, issues: ParseIssue[]): Span[] {
  const spans: Span[] = []
  const body = text.replace(/^\uFEFF/, '')
  const docs: { line: number; value: unknown }[] = []

  // A single pretty-printed document, or one export request per line.
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

  for (const { line, value } of docs) {
    const resourceSpans = (value as { resourceSpans?: unknown })?.resourceSpans
    if (!Array.isArray(resourceSpans)) {
      issues.push({ line, severity: 'error', message: 'Expected an OTLP export with "resourceSpans"' })
      continue
    }
    for (const rs of resourceSpans as { resource?: { attributes?: KeyValue[] }; scopeSpans?: { spans?: OtlpSpan[] }[] }[]) {
      const resource = attributes(rs.resource?.attributes)
      for (const ss of rs.scopeSpans ?? []) {
        for (const raw of ss.spans ?? []) {
          const span = toSpan(raw, resource, line)
          if (span) spans.push(span)
          else issues.push({ line, severity: 'error', message: `Span "${raw.name ?? '?'}" is missing traceId, spanId or times` })
        }
      }
    }
  }
  return spans
}

function toSpan(raw: OtlpSpan, resource: Record<string, unknown>, line: number): Span | undefined {
  const startMs = nanosToMs(raw.startTimeUnixNano)
  const endMs = nanosToMs(raw.endTimeUnixNano)
  if (!raw.traceId || !raw.spanId || startMs === undefined || endMs === undefined) return undefined
  const code = raw.status?.code
  return {
    line,
    traceId: raw.traceId,
    spanId: raw.spanId,
    parentSpanId: raw.parentSpanId || undefined,
    name: raw.name ?? '',
    startMs,
    endMs: Math.max(endMs, startMs),
    attrs: attributes(raw.attributes),
    resource,
    events: (raw.events ?? []).map((e) => ({
      timeMs: nanosToMs(e.timeUnixNano) ?? startMs,
      name: e.name ?? '',
      attrs: attributes(e.attributes),
    })),
    error: code === 2 || code === 'STATUS_CODE_ERROR',
    statusMessage: raw.status?.message || undefined,
  }
}

function traceToEvents(spans: Span[]): EventRecord[] {
  spans.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs)
  const runId = spans[0]!.traceId
  // The outermost invoke_agent span is the run; nested ones are sub-agents.
  const agentSpans = spans.filter((s) => s.attrs['gen_ai.operation.name'] === 'invoke_agent')
  const root = agentSpans[0]
  const first = spans[0]!
  const startMs = root?.startMs ?? first.startMs
  const endMs = root?.endMs ?? Math.max(...spans.map((s) => s.endMs))
  const out: EventRecord[] = []
  const add = (line: number, value: Record<string, unknown>) => out.push({ line, value: { run_id: runId, ...value } })

  const agentName = str(root?.attrs['gen_ai.agent.name']) ?? str(first.resource['service.name']) ?? 'agent'
  add(root?.line ?? first.line, {
    type: 'run.start',
    v: SCHEMA_VERSION,
    id: `${root?.spanId ?? runId}-start`,
    ts: iso(startMs),
    agent: { name: agentName, ...(str(root?.attrs['gen_ai.agent.version']) && { version: str(root?.attrs['gen_ai.agent.version']) }) },
    input: root ? promptOf(root.attrs['gen_ai.input.messages']) : undefined,
    attrs: { source: 'otlp', trace_id: runId, ...(root && { span_id: root.spanId }) },
  })

  let step = 0
  let lastModel: { id: string; error: boolean; model: string } | undefined
  const toolAttempts = new Map<string, { id: string; attempt: number; error: boolean }>()

  for (const span of spans) {
    if (span === root) continue
    const op = span.attrs['gen_ai.operation.name'] as string
    const common = {
      id: span.spanId,
      ts: iso(span.startMs),
      ...(span.parentSpanId && { parent_id: span.parentSpanId }),
    }
    const duration_ms = Math.round(span.endMs - span.startMs)
    const error = span.error ? errorInfo(span) : undefined

    if (MODEL_OPERATIONS.has(op)) {
      const model = str(span.attrs['gen_ai.response.model']) ?? str(span.attrs['gen_ai.request.model']) ?? 'unknown'
      // A model call straight after a failed call to the same model is treated as its retry.
      const retry = lastModel?.error && lastModel.model === model ? lastModel : undefined
      if (!retry) step += 1
      const output = outputOf(span.attrs['gen_ai.output.messages'])
      add(span.line, {
        type: 'model.call',
        ...common,
        step,
        provider: str(span.attrs['gen_ai.provider.name']) ?? str(span.attrs['gen_ai.system']) ?? 'unknown',
        model,
        duration_ms,
        status: span.error ? 'error' : 'ok',
        input: messages(span.attrs['gen_ai.input.messages']),
        ...(output && { output }),
        ...(firstOf(span.attrs['gen_ai.response.finish_reasons']) && {
          stop_reason: firstOf(span.attrs['gen_ai.response.finish_reasons']),
        }),
        ...usageOf(span.attrs),
        ...(retry && { attempt: 2, retry_of: retry.id }),
        ...(error && { error }),
      })
      lastModel = { id: span.spanId, error: span.error, model }
      continue
    }

    if (op === 'execute_tool') {
      const callId = str(span.attrs['gen_ai.tool.call.id'])
      const previous = callId ? toolAttempts.get(callId) : undefined
      const retry = previous?.error ? previous : undefined
      const approvals = approvalEvents(span, runId, Math.max(step, 1))
      const decided = approvals.find((a) => a.type === 'approval.decision')
      add(span.line, {
        type: 'tool.call',
        ...common,
        step: Math.max(step, 1),
        tool: str(span.attrs['gen_ai.tool.name']) ?? (span.name || 'tool'),
        ...(callId && { call_id: callId }),
        duration_ms,
        status: span.error ? 'error' : 'ok',
        input: json(span.attrs['gen_ai.tool.call.arguments']),
        output: json(span.attrs['gen_ai.tool.call.result']),
        ...(decided && { approval_id: decided.approval_id }),
        ...(retry && { attempt: retry.attempt + 1, retry_of: retry.id }),
        ...(error && { error }),
      })
      for (const approval of approvals) add(span.line, approval)
      if (callId) toolAttempts.set(callId, { id: span.spanId, attempt: (retry?.attempt ?? 0) + 1, error: span.error })
      lastModel = undefined
      continue
    }

    if (op === 'invoke_agent') {
      add(span.line, {
        type: 'log',
        ...common,
        ...(step > 0 && { step }),
        level: span.error ? 'warn' : 'info',
        message: `Sub-agent ${str(span.attrs['gen_ai.agent.name']) ?? span.name} ran for ${duration_ms} ms${span.error ? ' and failed' : ''}`,
      })
      continue
    }

    // Other GenAI operations (embeddings, retrieval, memory, ...) are kept as generic rows.
    add(span.line, { type: `otel.${op}`, ...common, ...(step > 0 && { step }), attrs: { ...span.attrs, duration_ms } })
  }

  const rootError = root?.error ? errorInfo(root) : undefined
  const anyError = !root && spans.some((s) => s.error)
  add(root?.line ?? first.line, {
    type: 'run.end',
    id: `${root?.spanId ?? runId}-end`,
    ts: iso(endMs),
    status: rootError || anyError ? 'failed' : 'succeeded',
    ...(root && outputOf(root.attrs['gen_ai.output.messages'])?.text !== undefined && {
      output: outputOf(root.attrs['gen_ai.output.messages'])!.text,
    }),
    ...(rootError && { error: rootError }),
  })
  return out
}

// Approvals have no OTel convention; Trailview reads span events named
// trailview.approval.request and trailview.approval.decision (see docs/schema.md).
function approvalEvents(span: Span, runId: string, step: number): (Record<string, unknown> & { type: string; approval_id: string })[] {
  const out: (Record<string, unknown> & { type: string; approval_id: string })[] = []
  span.events.forEach((event, index) => {
    const a = event.attrs
    const approvalId = str(a['trailview.approval.id'])
    if (!approvalId) return
    const base = { run_id: runId, id: `${span.spanId}-ap${index + 1}`, ts: iso(event.timeMs), step, approval_id: approvalId }
    if (event.name === 'trailview.approval.request') {
      out.push({
        ...base,
        type: 'approval.request',
        action: str(a['trailview.approval.action']) ?? str(span.attrs['gen_ai.tool.name']) ?? 'action',
        summary: str(a['trailview.approval.summary']) ?? '',
        ...(str(span.attrs['gen_ai.tool.call.id']) && { call_id: str(span.attrs['gen_ai.tool.call.id']) }),
        ...(str(a['trailview.approval.policy']) && { policy: str(a['trailview.approval.policy']) }),
      })
    } else if (event.name === 'trailview.approval.decision') {
      out.push({
        ...base,
        type: 'approval.decision',
        decision: str(a['trailview.approval.decision']),
        by: {
          kind: str(a['trailview.approval.by.kind']) ?? 'human',
          ...(str(a['trailview.approval.by.name']) && { name: str(a['trailview.approval.by.name']) }),
        },
        ...(str(a['trailview.approval.reason']) && { reason: str(a['trailview.approval.reason']) }),
      })
    }
  })
  return out
}

function usageOf(attrs: Record<string, unknown>): { usage?: Record<string, number> } {
  const input = num(attrs['gen_ai.usage.input_tokens'])
  const output = num(attrs['gen_ai.usage.output_tokens'])
  if (input === undefined && output === undefined) return {}
  const cacheRead = num(attrs['gen_ai.usage.cache_read.input_tokens'])
  const cacheWrite = num(attrs['gen_ai.usage.cache_write.input_tokens']) ?? num(attrs['gen_ai.usage.cache_creation.input_tokens'])
  // OTel counts cached tokens inside input_tokens; Trailview keeps them separate.
  const uncached = Math.max(0, (input ?? 0) - (cacheRead ?? 0) - (cacheWrite ?? 0))
  return {
    usage: {
      input_tokens: uncached,
      output_tokens: output ?? 0,
      ...(cacheRead !== undefined && { cache_read_tokens: cacheRead }),
      ...(cacheWrite !== undefined && { cache_write_tokens: cacheWrite }),
    },
  }
}

type Part = { type?: string; content?: unknown; id?: string; name?: string; arguments?: unknown }
type Message = { role?: string; parts?: Part[] }

function outputOf(value: unknown): { text?: string; tool_calls?: { id: string; name: string; input?: unknown }[] } | undefined {
  const list = messages(value)
  if (!Array.isArray(list)) return undefined
  const parts = (list as Message[]).flatMap((m) => m?.parts ?? [])
  const text = parts
    .filter((p) => p.type === 'text' && typeof p.content === 'string')
    .map((p) => p.content as string)
    .join('\n')
  const toolCalls = parts
    .filter((p) => p.type === 'tool_call' && p.name)
    .map((p, i) => ({ id: p.id || `call_${i + 1}`, name: p.name!, input: json(p.arguments) }))
  if (!text && toolCalls.length === 0) return undefined
  return { ...(text && { text }), ...(toolCalls.length > 0 && { tool_calls: toolCalls }) }
}

// The run's input as plain text when it is only user text, else the messages as logged.
function promptOf(value: unknown): unknown {
  const list = messages(value)
  if (!Array.isArray(list)) return list
  const parts = (list as Message[]).flatMap((m) => (m?.role === 'user' ? (m.parts ?? []) : [undefined]))
  if (parts.length === 0 || !parts.every((p) => p?.type === 'text' && typeof p.content === 'string')) return list
  return parts.map((p) => p!.content).join('\n')
}

function errorInfo(span: Span): { type: string; message: string } {
  const exception = span.events.find((e) => e.name === 'exception')
  const type = str(span.attrs['error.type']) ?? str(exception?.attrs['exception.type']) ?? 'error'
  const message = span.statusMessage ?? str(exception?.attrs['exception.message']) ?? type
  return { type, message }
}

function attributes(list: KeyValue[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const kv of list ?? []) if (kv?.key) out[kv.key] = anyValue(kv.value)
  return out
}

function anyValue(v: AnyValue | undefined): unknown {
  if (!v) return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(anyValue)
  if (v.kvlistValue) return attributes(v.kvlistValue.values)
  if (v.bytesValue !== undefined) return v.bytesValue
  return undefined
}

function nanosToMs(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  try {
    const ns = BigInt(typeof value === 'number' ? Math.round(value) : value)
    return Number(ns / 1000n) / 1000
  } catch {
    return undefined
  }
}

// Message and tool payloads may arrive as JSON strings or as structured values.
function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const messages = json
const iso = (ms: number) => new Date(ms).toISOString()
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const firstOf = (v: unknown) => (Array.isArray(v) ? str(v[0]) : str(v))
