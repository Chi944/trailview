# Trailview JSONL format, version 1

A Trailview log is a text file with one JSON object per line. Each line is one event in an agent run. This page is the reference for writing those files; the zod schemas in [`src/core/schema/events.ts`](../src/core/schema/events.ts) are the executable version.

## Design decisions

- **Steps are a field.** Each event carries an optional `step` number instead of separate step start and end events.
- **Calls are written when they finish.** One line per finished model or tool call, with `ts` as its start time and `duration_ms`. A crash loses only the call that was in flight.
- **Cost comes from the log when present.** If a `model.call` has `cost_usd` the viewer uses it; otherwise it estimates from a bundled price table (or `run.start.pricing`) and labels the figure "est.".

## Principles

- **One JSON object per line, UTF-8.** Blank lines are ignored. A file may hold several runs; every line carries `run_id`.
- **Append-friendly.** An agent writes each line when the thing it describes has finished, so a log stays valid if the process dies (only an in-flight call is lost).
- **Forgiving reader, strict writer.** The viewer validates each line with zod. A bad line is skipped and listed in an Issues panel with its line number; it never blocks the rest of the file. Unknown fields are kept and shown in the raw view. Unknown `type` values render as a generic row.
- **The viewer computes totals.** Token and cost totals, durations and retry counts are derived from the events, never trusted from a summary line.
- **Small vocabulary.** Eight event types cover the MVP. Steps are a number on each event rather than separate events.

## Common envelope (every line)

| Field | Type | Req. | Notes |
|---|---|---|---|
| `type` | string | yes | One of the event types below. |
| `run_id` | string | yes | Groups lines into runs. |
| `id` | string | yes | Unique within the run. Other events refer to it. |
| `ts` | string | yes | ISO 8601 UTC with milliseconds. For calls, this is the **start** time. |
| `step` | integer ≥ 1 | no | The agent-loop iteration this event belongs to. The timeline groups by it. |
| `parent_id` | string | no | Reserved for nesting (sub-agents). Ignored by the MVP UI. |
| `attrs` | object | no | Free-form extra data, shown in the detail panel as key/value pairs. |

Ordering: the viewer sorts by `ts`, then by file order for ties.

## Event types

**`run.start`**: one per run, first line.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `v` | integer | yes | Schema version. `1` for this proposal. |
| `agent` | `{ name, version? }` | yes | |
| `input` | any JSON | no | The task the run was given. |
| `pricing` | object | no | Per-model price overrides, `{ "<model>": { "input_per_mtok": n, "output_per_mtok": n } }`. |

**`run.end`**: one per run, last line. If missing, the run is shown as *incomplete*.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `status` | `"succeeded" \| "failed" \| "cancelled"` | yes | |
| `output` | any JSON | no | Final answer. |
| `error` | Error | no | When `status` is `failed`. |

**`model.call`**: one finished request to a model.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `provider` | string | yes | e.g. `anthropic`, `openai`. |
| `model` | string | yes | Used to look up price. |
| `duration_ms` | integer | yes | |
| `status` | `"ok" \| "error"` | yes | |
| `input` | any JSON | no | Messages sent. Optional so people can keep prompts out of logs. |
| `output` | `{ text?, tool_calls?: [{ id, name, input }] }` | no | `tool_calls[].id` links to `tool.call.call_id`. |
| `stop_reason` | string | no | e.g. `end_turn`, `tool_use`, `max_tokens`. |
| `usage` | `{ input_tokens, output_tokens, cache_read_tokens?, cache_write_tokens? }` | no | Integers. |
| `cost_usd` | number | no | If absent, the viewer estimates from its price table and marks the figure "est.". |
| `attempt`, `retry_of`, `error` | | no | See *Retries* below. |

**`tool.call`**: one finished tool execution.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `tool` | string | yes | Tool name. |
| `call_id` | string | no | The model's tool-call id that asked for this. |
| `duration_ms` | integer | yes | |
| `status` | `"ok" \| "error"` | yes | |
| `input`, `output` | any JSON | no | |
| `approval_id` | string | no | Set when the call ran after an approval. |
| `attempt`, `retry_of`, `error` | | no | See *Retries* below. |

**`approval.request`**: the agent paused for a person.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `approval_id` | string | yes | |
| `action` | string | yes | Usually the tool name. |
| `summary` | string | yes | One line shown in the timeline. |
| `call_id` | string | no | The model tool-call the approval gates. |
| `policy` | string | no | Why approval was needed. |

**`approval.decision`**: the person's answer.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `approval_id` | string | yes | Matches the request. |
| `decision` | `"approved" \| "rejected"` | yes | |
| `by` | `{ kind: "human" \| "policy", name? }` | yes | |
| `reason` | string | no | |

The viewer computes wait time as `decision.ts − request.ts`. A rejected request has no `tool.call`; the agent's next `model.call` shows what it did instead.

**`error`**: an error not tied to one call (crash, config problem). Fields: `error` (required).

**`log`**: a free-text note from the agent. Fields: `level` (`debug|info|warn`), `message`.

## Shared shapes

**Error**: `{ type: string, message: string, retryable?: boolean, code?: string | number }`

**Retries**: a retried call is a new event with `attempt` (1-based) and `retry_of` (the `id` of the failed attempt). The failed attempt keeps `status: "error"` and its `error`. The timeline shows the chain as one row with a "2 attempts" badge that expands; the totals count every attempt's tokens and cost, because they were really spent.

## Payload size

Any `input` or `output` may be replaced by `{ "truncated": true, "bytes": n, "preview": "…" }`. The viewer shows the preview and the original size.

## OpenTelemetry mapping (phase 2)

Planned adapter from GenAI semantic-convention spans to these events. The conventions are still marked as in development, so attribute names will be checked against the current spec when the adapter is built.

| OTel | Trailview |
|---|---|
| span with `gen_ai.operation.name` = `chat` / `text_completion` | `model.call` |
| span with `gen_ai.operation.name` = `execute_tool` | `tool.call` |
| span with `gen_ai.operation.name` = `invoke_agent` | `run.start` + `run.end` |
| `gen_ai.request.model`, `gen_ai.provider.name` | `model`, `provider` |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | `usage.*` |
| `gen_ai.response.finish_reasons` | `stop_reason` |
| `gen_ai.tool.name`, `gen_ai.tool.call.id` | `tool`, `call_id` |
| span start time, duration, status, `error.type` | `ts`, `duration_ms`, `status`, `error.type` |
| span events or attributes under `trailview.approval.*` | `approval.*` (OTel has no approval concept) |

---

## Example run (13 events)

This is a condensed version of the run bundled as [`samples/oncall-digest.jsonl`](../samples/oncall-digest.jsonl), and is kept verbatim in [`src/test/schema-example.jsonl`](../src/test/schema-example.jsonl), where the unit tests check it against the table below; the bundled file adds a log lookup, an on-call schedule lookup, full prompts and outputs, and costs at current list prices. An on-call digest agent looks up yesterday's failed jobs (the first lookup times out and is retried), drafts an email to the whole engineering list, gets **rejected**, re-targets the on-call engineer, gets **approved**, sends, and finishes. Prices are illustrative.

```jsonl
{"type":"run.start","v":1,"run_id":"run_7f3a","id":"e01","ts":"2026-10-18T09:14:02.120Z","agent":{"name":"oncall-digest","version":"0.4.2"},"input":"Summarise yesterday's failed jobs and email the on-call engineer.","attrs":{"env":"local"}}
{"type":"model.call","run_id":"run_7f3a","id":"e02","ts":"2026-10-18T09:14:02.300Z","step":1,"provider":"anthropic","model":"claude-sonnet-5-5","duration_ms":2140,"status":"ok","input":[{"role":"user","content":"Summarise yesterday's failed jobs and email the on-call engineer."}],"output":{"text":"I'll look up yesterday's failed jobs.","tool_calls":[{"id":"tu_1","name":"query_jobs","input":{"status":"failed","since":"2026-10-17"}}]},"stop_reason":"tool_use","usage":{"input_tokens":1820,"output_tokens":96},"cost_usd":0.0069}
{"type":"tool.call","run_id":"run_7f3a","id":"e03","ts":"2026-10-18T09:14:04.460Z","step":1,"tool":"query_jobs","call_id":"tu_1","input":{"status":"failed","since":"2026-10-17"},"duration_ms":10000,"status":"error","attempt":1,"error":{"type":"timeout","message":"jobs API did not respond within 10s","retryable":true}}
{"type":"tool.call","run_id":"run_7f3a","id":"e04","ts":"2026-10-18T09:14:15.480Z","step":1,"tool":"query_jobs","call_id":"tu_1","input":{"status":"failed","since":"2026-10-17"},"duration_ms":840,"status":"ok","attempt":2,"retry_of":"e03","output":{"count":3,"jobs":[{"id":"job_812","name":"nightly-backup","error":"disk quota exceeded"},{"id":"job_815","name":"invoice-sync","error":"401 from billing API"},{"id":"job_820","name":"search-reindex","error":"OOM killed"}]}}
{"type":"model.call","run_id":"run_7f3a","id":"e05","ts":"2026-10-18T09:14:16.400Z","step":2,"provider":"anthropic","model":"claude-sonnet-5-5","duration_ms":5200,"status":"ok","output":{"text":"Drafting the summary email.","tool_calls":[{"id":"tu_2","name":"send_email","input":{"to":"eng-all@example.com","subject":"3 failed jobs on 17 Oct","body":"nightly-backup: disk quota exceeded\ninvoice-sync: 401 from billing API\nsearch-reindex: OOM killed"}}]},"stop_reason":"tool_use","usage":{"input_tokens":4310,"output_tokens":412},"cost_usd":0.0191}
{"type":"approval.request","run_id":"run_7f3a","id":"e06","ts":"2026-10-18T09:14:21.650Z","step":2,"approval_id":"ap_1","call_id":"tu_2","action":"send_email","summary":"Send email to eng-all@example.com","policy":"external_side_effect"}
{"type":"approval.decision","run_id":"run_7f3a","id":"e07","ts":"2026-10-18T09:16:03.010Z","step":2,"approval_id":"ap_1","decision":"rejected","by":{"kind":"human","name":"d"},"reason":"Only the on-call engineer, not the whole list."}
{"type":"model.call","run_id":"run_7f3a","id":"e08","ts":"2026-10-18T09:16:03.200Z","step":3,"provider":"anthropic","model":"claude-sonnet-5-5","duration_ms":4700,"status":"ok","output":{"text":"Re-addressing to the on-call engineer.","tool_calls":[{"id":"tu_3","name":"send_email","input":{"to":"oncall@example.com","subject":"3 failed jobs on 17 Oct","body":"nightly-backup: disk quota exceeded\ninvoice-sync: 401 from billing API\nsearch-reindex: OOM killed"}}]},"stop_reason":"tool_use","usage":{"input_tokens":4960,"output_tokens":380},"cost_usd":0.0206}
{"type":"approval.request","run_id":"run_7f3a","id":"e09","ts":"2026-10-18T09:16:07.950Z","step":3,"approval_id":"ap_2","call_id":"tu_3","action":"send_email","summary":"Send email to oncall@example.com","policy":"external_side_effect"}
{"type":"approval.decision","run_id":"run_7f3a","id":"e10","ts":"2026-10-18T09:16:30.400Z","step":3,"approval_id":"ap_2","decision":"approved","by":{"kind":"human","name":"d"}}
{"type":"tool.call","run_id":"run_7f3a","id":"e11","ts":"2026-10-18T09:16:30.500Z","step":3,"tool":"send_email","call_id":"tu_3","approval_id":"ap_2","input":{"to":"oncall@example.com","subject":"3 failed jobs on 17 Oct"},"duration_ms":610,"status":"ok","output":{"message_id":"msg_4471"}}
{"type":"model.call","run_id":"run_7f3a","id":"e12","ts":"2026-10-18T09:16:31.200Z","step":4,"provider":"anthropic","model":"claude-sonnet-5-5","duration_ms":1900,"status":"ok","output":{"text":"Sent a summary of 3 failed jobs to the on-call engineer."},"stop_reason":"end_turn","usage":{"input_tokens":5480,"output_tokens":140},"cost_usd":0.0185}
{"type":"run.end","run_id":"run_7f3a","id":"e13","ts":"2026-10-18T09:16:33.150Z","status":"succeeded","output":"Sent a summary of 3 failed jobs to the on-call engineer."}
```

What the viewer derives from this file:

| Derived value | Result |
|---|---|
| Wall time | 2 min 31.03 s |
| Time waiting on a person | 2 min 3.81 s (101.36 s + 22.45 s) |
| Model calls / tool calls | 4 / 3 (one retry chain of 2 attempts) |
| Tokens | 16,570 in, 1,028 out |
| Cost | US$0.0651 |
| Approvals | 2 requested, 1 rejected, 1 approved |
| Errors | 1 (recovered by retry) |
