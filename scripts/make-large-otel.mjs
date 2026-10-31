// Writes a large synthetic OTLP/JSON trace for performance checks:
//   node scripts/make-large-otel.mjs 100000 > /tmp/large.otlp.json
// One invoke_agent root span with alternating chat and execute_tool children,
// a failed-then-retried model call every 50 steps, and an approval every 200.
const spanCount = Number(process.argv[2] ?? 20000)
const perLine = process.argv.includes('--per-line')
const traceId = '7f'.repeat(16)
const startNs = 1792404000000000000n
const hex = (n) => n.toString(16).padStart(16, '0')
const kv = (key, value) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
})

const spans = []
let t = startNs
const span = (id, name, attrs, durationMs, extra = {}) => {
  const s = {
    traceId,
    spanId: hex(id),
    parentSpanId: hex(1),
    name,
    startTimeUnixNano: String(t),
    endTimeUnixNano: String(t + BigInt(durationMs) * 1000000n),
    attributes: attrs,
    status: { code: 1 },
    ...extra,
  }
  t += BigInt(durationMs + 5) * 1000000n
  return s
}

for (let i = 2; i <= spanCount; i++) {
  const step = Math.floor(i / 2)
  if (i % 2 === 0) {
    const failed = step % 50 === 0 && !spans.at(-1)?.status.message
    spans.push(
      span(i, 'chat claude-sonnet-5-5', [
        kv('gen_ai.operation.name', 'chat'),
        kv('gen_ai.provider.name', 'anthropic'),
        kv('gen_ai.request.model', 'claude-sonnet-5-5'),
        kv('gen_ai.usage.input_tokens', 1200 + (i % 700)),
        kv('gen_ai.usage.output_tokens', 80 + (i % 90)),
        kv('gen_ai.input.messages', JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: `Step ${step}: continue the task.` }] }])),
        kv('gen_ai.output.messages', JSON.stringify([{ role: 'assistant', parts: [{ type: 'tool_call', id: `call_${i}`, name: 'search', arguments: { q: `query ${step}` } }] }])),
      ], 400 + (i % 900), failed ? { status: { code: 2, message: '529 Overloaded' } } : {}),
    )
  } else {
    const approval = step % 200 === 0
    spans.push(
      span(i, 'execute_tool search', [
        kv('gen_ai.operation.name', 'execute_tool'),
        kv('gen_ai.tool.name', 'search'),
        kv('gen_ai.tool.call.id', `call_${i - 1}`),
        kv('gen_ai.tool.call.arguments', JSON.stringify({ q: `query ${step}` })),
        kv('gen_ai.tool.call.result', JSON.stringify({ hits: [`doc-${step}-a`, `doc-${step}-b`], took_ms: i % 120 })),
      ], 30 + (i % 200), approval ? {
        events: [
          { timeUnixNano: String(t), name: 'trailview.approval.request', attributes: [kv('trailview.approval.id', `ap_${i}`), kv('trailview.approval.summary', 'Run search')] },
          { timeUnixNano: String(t + 1000000n), name: 'trailview.approval.decision', attributes: [kv('trailview.approval.id', `ap_${i}`), kv('trailview.approval.decision', 'approved')] },
        ],
      } : {}),
    )
  }
}

const root = {
  traceId,
  spanId: hex(1),
  name: 'invoke_agent large-agent',
  startTimeUnixNano: String(startNs),
  endTimeUnixNano: String(t),
  attributes: [kv('gen_ai.operation.name', 'invoke_agent'), kv('gen_ai.agent.name', 'large-agent')],
  status: { code: 1 },
}
const resource = { attributes: [kv('service.name', 'large-agent')] }
const request = (list) => JSON.stringify({ resourceSpans: [{ resource, scopeSpans: [{ scope: { name: 'perf' }, spans: list }] }] })

if (perLine) {
  // The collector's file exporter writes one export request per batch.
  const lines = [request([root])]
  for (let i = 0; i < spans.length; i += 512) lines.push(request(spans.slice(i, i + 512)))
  process.stdout.write(lines.join('\n') + '\n')
} else {
  process.stdout.write(request([root, ...spans]))
}
