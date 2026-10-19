// Writes two hand-designed sample runs to samples/. They are synthetic and
// deterministic: no API calls, no randomness beyond a fixed seed.
// Usage: node scripts/make-synthetic-samples.mjs
import { writeFileSync } from 'node:fs'

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

class RunWriter {
  constructor(runId, startIso, seed) {
    this.runId = runId
    this.t = Date.parse(startIso)
    this.n = 0
    this.lines = []
    this.rand = rng(seed)
  }
  between(lo, hi) {
    return Math.round(lo + this.rand() * (hi - lo))
  }
  advance(ms) {
    this.t += ms
  }
  emit(fields, durationMs = 0) {
    const id = `e${String(++this.n).padStart(3, '0')}`
    this.lines.push(JSON.stringify({ type: fields.type, run_id: this.runId, id, ts: new Date(this.t).toISOString(), ...fields }))
    this.advance(durationMs + this.between(20, 120))
    return id
  }
  model(step, fields) {
    const duration = this.between(1200, 6500)
    return this.emit({ type: 'model.call', step, provider: 'anthropic', duration_ms: duration, status: 'ok', ...fields }, duration)
  }
  tool(step, fields, duration = this.between(80, 1500)) {
    return this.emit({ type: 'tool.call', step, duration_ms: duration, status: 'ok', ...fields }, duration)
  }
  write(path) {
    writeFileSync(path, this.lines.join('\n') + '\n')
    console.log(`${path}: ${this.lines.length} events`)
  }
}

// A coding agent that cannot get a test to pass and stops at its step limit.
// No cost_usd is logged, so the viewer estimates cost from its price table.
function codingAgent() {
  const w = new RunWriter('run_fix_flaky_42', '2026-10-17T14:02:11.000Z', 42)
  const model = 'claude-sonnet-5-5'
  let ctx = 3200
  const call = (step, output, extra = {}) => {
    const out = w.between(120, 900)
    const id = w.model(step, { model, usage: { input_tokens: ctx, output_tokens: out }, output, stop_reason: output.tool_calls ? 'tool_use' : 'end_turn', ...extra })
    ctx += out + w.between(600, 2400)
    return id
  }
  w.emit({ type: 'run.start', v: 1, agent: { name: 'patchbot', version: '1.3.0' }, input: 'CI is red on main: tests/test_scheduler.py::test_backoff_caps fails. Find the cause and fix it.', attrs: { repo: 'acme/scheduler', branch: 'main', max_steps: 6 } })

  call(1, { text: 'Let me run the failing test first.', tool_calls: [{ id: 'tu_01', name: 'run_tests', input: { path: 'tests/test_scheduler.py::test_backoff_caps' } }] })
  w.tool(1, { tool: 'run_tests', call_id: 'tu_01', input: { path: 'tests/test_scheduler.py::test_backoff_caps' }, status: 'error', output: { passed: 0, failed: 1, stdout: 'AssertionError: assert 64.0 <= 30.0\n  where 64.0 = backoff(attempt=6)' }, error: { type: 'test_failure', message: '1 failed: assert 64.0 <= 30.0', retryable: false } }, 4210)

  call(2, { text: 'The cap is not applied. Reading the implementation.', tool_calls: [{ id: 'tu_02', name: 'read_file', input: { path: 'scheduler/backoff.py' } }] })
  w.tool(2, { tool: 'read_file', call_id: 'tu_02', input: { path: 'scheduler/backoff.py' }, output: 'def backoff(attempt, base=1.0, cap=30.0):\n    delay = base * 2 ** attempt\n    return delay if delay < cap else delay\n' })

  call(3, { text: 'The else branch returns delay instead of cap. Fixing.', tool_calls: [{ id: 'tu_03', name: 'edit_file', input: { path: 'scheduler/backoff.py', old: 'return delay if delay < cap else delay', new: 'return min(delay, cap)' } }] })
  w.tool(3, { tool: 'edit_file', call_id: 'tu_03', input: { path: 'scheduler/backoff.py', old: 'return delay if delay < cap else delay', new: 'return min(delay, cap)' }, output: { ok: true, lines_changed: 1 } })
  w.emit({ type: 'log', step: 3, level: 'info', message: 'Applied 1 edit to scheduler/backoff.py' })

  // The model call hits a rate limit and is retried after a backoff.
  const limited = w.emit({ type: 'model.call', step: 4, provider: 'anthropic', model, duration_ms: 310, status: 'error', attempt: 1, error: { type: 'rate_limit', code: 429, message: 'Too many requests', retryable: true } }, 310)
  w.advance(4000)
  const out = 140
  w.emit({ type: 'model.call', step: 4, provider: 'anthropic', model, duration_ms: 1800, status: 'ok', attempt: 2, retry_of: limited, usage: { input_tokens: ctx, output_tokens: out }, output: { text: 'Re-running the test.', tool_calls: [{ id: 'tu_04', name: 'run_tests', input: { path: 'tests/test_scheduler.py' } }] }, stop_reason: 'tool_use' }, 1800)
  ctx += out + 900
  w.tool(4, { tool: 'run_tests', call_id: 'tu_04', input: { path: 'tests/test_scheduler.py' }, status: 'error', output: { passed: 11, failed: 1, stdout: 'FAILED test_jitter_is_bounded: assert 31.7 <= 30.0' }, error: { type: 'test_failure', message: '1 failed: test_jitter_is_bounded', retryable: false } }, 6020)

  call(5, { text: 'Jitter is added after the cap. Reading the jitter helper.', tool_calls: [{ id: 'tu_05', name: 'read_file', input: { path: 'scheduler/jitter.py' } }] })
  w.tool(5, { tool: 'read_file', call_id: 'tu_05', input: { path: 'scheduler/jitter.py' }, status: 'error', error: { type: 'not_found', message: 'scheduler/jitter.py does not exist', retryable: false } })
  w.emit({ type: 'log', step: 5, level: 'warn', message: 'Tool error fed back to the model: file not found' })

  call(6, { text: 'Searching for where jitter is applied.', tool_calls: [{ id: 'tu_06', name: 'grep', input: { pattern: 'jitter', path: 'scheduler/' } }] })
  w.tool(6, { tool: 'grep', call_id: 'tu_06', input: { pattern: 'jitter', path: 'scheduler/' }, output: ['scheduler/retry.py:18:    delay = backoff(attempt) + random.uniform(0, 2)'] })

  w.emit({ type: 'error', error: { type: 'step_limit', message: 'Stopped after 6 steps (max_steps=6) with tests still failing', retryable: false } })
  w.emit({ type: 'run.end', status: 'failed', error: { type: 'step_limit', message: 'Step limit reached before the fix was complete' }, output: 'Partial fix: capped backoff in scheduler/backoff.py. Jitter in scheduler/retry.py:18 still pushes delays over the cap.' })
  w.write('samples/patchbot-failed.jsonl')
}

// A long research run: many searches and page fetches, prompt caching, one
// fetch that times out and is retried, a policy-approved file write and an
// event type the viewer does not know.
function researchAgent() {
  const w = new RunWriter('run_research_7', '2026-10-16T08:30:00.000Z', 7)
  const model = 'claude-opus-5-5'
  const price = { in: 4, out: 20, cacheRead: 0.2 }
  let ctx = 2400
  let step = 0
  const call = (output, stop = 'tool_use') => {
    const out = w.between(150, 700)
    const cached = Math.max(0, ctx - w.between(800, 2500))
    const fresh = ctx - cached
    const cost = (fresh * price.in + cached * price.cacheRead + out * price.out) / 1e6
    w.model(step, { model, usage: { input_tokens: fresh, output_tokens: out, cache_read_tokens: cached }, cost_usd: Math.round(cost * 1e6) / 1e6, output, stop_reason: stop })
    ctx += out
  }
  const topics = [
    'durable execution engines for agents',
    'Temporal workflow determinism constraints',
    'human-in-the-loop approval patterns',
    'audit logging for LLM tool calls',
    'idempotency keys for tool side effects',
    'checkpointing agent state',
    'OpenTelemetry GenAI semantic conventions',
    'cost attribution per agent step',
    'retry budgets and backoff for LLM APIs',
  ]
  w.emit({ type: 'run.start', v: 1, agent: { name: 'deep-research', version: '0.9.1' }, input: 'Write a 2-page brief on making AI agents reliable in production: durable state, approvals, audit trails and observability. Cite sources.', attrs: { budget_usd: 2 } })

  topics.forEach((topic, i) => {
    step++
    const q = `tu_s${i}`
    call({ text: `Searching: ${topic}`, tool_calls: [{ id: q, name: 'web_search', input: { query: topic } }] })
    const results = [1, 2, 3].map((k) => ({ url: `https://example.org/${topic.split(' ')[0].toLowerCase()}/${k}`, title: `${topic} (${k})` }))
    w.tool(step, { tool: 'web_search', call_id: q, input: { query: topic }, output: { results } }, w.between(400, 1400))
    ctx += w.between(500, 900)

    step++
    const f = `tu_f${i}`
    const url = results[0].url
    call({ text: 'Reading the most relevant result.', tool_calls: [{ id: f, name: 'fetch_page', input: { url } }] })
    if (i === 4) {
      const first = w.tool(step, { tool: 'fetch_page', call_id: f, input: { url }, status: 'error', attempt: 1, error: { type: 'timeout', message: 'fetch timed out after 15s', retryable: true } }, 15000)
      w.advance(2000)
      w.tool(step, { tool: 'fetch_page', call_id: f, input: { url }, attempt: 2, retry_of: first, output: { truncated: true, bytes: 48211, preview: 'Idempotency keys let a retried tool call be recognised as a duplicate...' } }, 2300)
    } else {
      w.tool(step, { tool: 'fetch_page', call_id: f, input: { url }, output: { truncated: true, bytes: w.between(8000, 60000), preview: `${topic}: an overview of the main approaches and their trade-offs...` } }, w.between(600, 3000))
    }
    ctx += w.between(1500, 4000)
    if (i === 5) w.emit({ type: 'custom.checkpoint', step, attrs: { saved_bytes: 18234, storage: 'local' } })
  })

  step++
  call({ text: 'Drafting the brief and saving it.', tool_calls: [{ id: 'tu_w', name: 'write_file', input: { path: 'out/agent-reliability-brief.md', bytes: 9120 } }] })
  w.emit({ type: 'approval.request', step, approval_id: 'ap_write', call_id: 'tu_w', action: 'write_file', summary: 'Write out/agent-reliability-brief.md (9 KB)', policy: 'writes_inside_out_dir' })
  w.emit({ type: 'approval.decision', step, approval_id: 'ap_write', decision: 'approved', by: { kind: 'policy', name: 'allow-writes-in-out/' }, reason: 'Path is inside the allowed output directory' })
  w.tool(step, { tool: 'write_file', call_id: 'tu_w', approval_id: 'ap_write', input: { path: 'out/agent-reliability-brief.md', bytes: 9120 }, output: { ok: true } })

  step++
  call({ text: 'Saved a 2-page brief with 9 cited sources to out/agent-reliability-brief.md.' }, 'end_turn')
  w.emit({ type: 'run.end', status: 'succeeded', output: { file: 'out/agent-reliability-brief.md', sources: 9 } })
  w.write('samples/research-brief.jsonl')
}

codingAgent()
researchAgent()
