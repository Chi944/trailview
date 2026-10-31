# Try Trailview on your own logs

This guide gets one of your own agent runs into Trailview. Pick the route that matches what your agent already produces:

1. [Your agent already emits OpenTelemetry](#1-from-opentelemetry): save the traces to a file and open it.
2. [Your agent runs on LangChain or LangGraph with LangSmith](#2-from-langsmith): export a trace with the LangSmith SDK and open it.
3. [Neither](#3-write-trailview-jsonl-yourself): add a few lines of logging that write Trailview's own JSONL format.

Whichever route you take, open the file at [chi944.github.io/trailview](https://chi944.github.io/trailview/) or in a local copy (`npm run dev`). Drop it on the page or use the file picker. The file is read inside your browser tab and is never uploaded, and Trailview works out the format from the content, so the file name and extension do not matter.

## 1. From OpenTelemetry

Trailview reads OTLP/JSON spans that follow the [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai): `invoke_agent`, `chat` and `execute_tool` spans with `gen_ai.*` attributes. Many agent SDKs and instrumentation libraries emit these already.

The simplest way to get them into a file is an OpenTelemetry Collector with the file exporter (it ships in the `otelcol-contrib` distribution):

```yaml
# collector.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
exporters:
  file:
    path: ./traces.jsonl
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file]
```

```sh
otelcol-contrib --config collector.yaml
```

Point your agent's OTLP exporter at `http://127.0.0.1:4318` (for most SDKs, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`), run the agent, and open `traces.jsonl`. Each trace becomes one run. A single exported OTLP JSON document works too.

Spans without `gen_ai.operation.name`, such as HTTP or database spans, are skipped, and Trailview shows one warning with their count. OpenTelemetry has no field for approvals, so if you want them in the timeline, add `trailview.approval.request` and `trailview.approval.decision` span events to the `execute_tool` span; the attributes are listed in [the OpenTelemetry mapping](schema.md#opentelemetry-import).

## 2. From LangSmith

Trailview reads the run objects the LangSmith SDK returns. This script saves every run in one trace, one run per line:

```python
# export_trace.py: python export_trace.py <trace-id>
import json
import sys

from langsmith import Client

def encode(value):
    # Datetimes as ISO 8601, UUIDs and anything else as strings.
    return value.isoformat() if hasattr(value, "isoformat") else str(value)

client = Client()  # reads LANGSMITH_API_KEY from the environment
runs = client.list_runs(trace_id=sys.argv[1])
with open("trace.jsonl", "w") as f:
    for run in runs:
        f.write(json.dumps(run.dict(), default=encode) + "\n")
```

The trace id is in the LangSmith URL of the trace, or in `run.trace_id`. To export several traces into one file, call `list_runs` with `project_name=` and a filter instead, and every trace in the file becomes its own run in Trailview. A JSON array of runs, `{ "runs": [...] }` or one run with nested `child_runs` also work.

The API key is only used by your script to talk to LangSmith; Trailview itself never sees it.

## 3. Write Trailview JSONL yourself

Trailview's own format is one JSON object per line. Write each line when the thing it describes has finished, and append it to a file. Here is a complete, minimal run: a start, one model call that asks for a tool, the tool call, a final model call and an end.

```jsonl
{"type":"run.start","v":1,"run_id":"run_1","id":"e1","ts":"2026-10-27T10:00:00.000Z","agent":{"name":"my-agent","version":"0.1.0"},"input":"What is the weather in Lisbon?"}
{"type":"model.call","run_id":"run_1","id":"e2","ts":"2026-10-27T10:00:00.050Z","step":1,"provider":"anthropic","model":"claude-sonnet-5-5","duration_ms":1200,"status":"ok","output":{"tool_calls":[{"id":"tc_1","name":"get_weather","input":{"city":"Lisbon"}}]},"stop_reason":"tool_use","usage":{"input_tokens":420,"output_tokens":38}}
{"type":"tool.call","run_id":"run_1","id":"e3","ts":"2026-10-27T10:00:01.260Z","step":1,"tool":"get_weather","call_id":"tc_1","duration_ms":310,"status":"ok","input":{"city":"Lisbon"},"output":{"temp_c":21,"sky":"clear"}}
{"type":"model.call","run_id":"run_1","id":"e4","ts":"2026-10-27T10:00:01.580Z","step":2,"provider":"anthropic","model":"claude-sonnet-5-5","duration_ms":900,"status":"ok","output":{"text":"It is 21 °C and clear in Lisbon."},"stop_reason":"end_turn","usage":{"input_tokens":510,"output_tokens":14}}
{"type":"run.end","run_id":"run_1","id":"e5","ts":"2026-10-27T10:00:02.500Z","status":"succeeded","output":"It is 21 °C and clear in Lisbon."}
```

Save that as `weather.jsonl` and open it to see what each line turns into. A few rules carry most of the format:

- Every line has `type`, `run_id`, an `id` unique within the run, and `ts` in ISO 8601 UTC. For calls, `ts` is when the call **started**, and `duration_ms` is how long it took.
- `step` is the agent-loop iteration. The timeline groups by it.
- `tool.call.call_id` matches the `id` of the tool call in the model's output, which links the two.
- Leave out `cost_usd` and Trailview estimates cost from the model name, marked "est.". Include it if your provider reports it.
- `input` and `output` are optional, so you can keep prompts out of the log.

### A small logger

This is all the code a TypeScript agent needs. Call `log()` after each model call and tool call finishes.

```ts
import { appendFileSync } from 'node:fs'

const file = `run-${Date.now()}.jsonl`
const runId = crypto.randomUUID()
let seq = 0

export function log(event: Record<string, unknown>) {
  const line = { run_id: runId, id: `e${++seq}`, ts: new Date().toISOString(), ...event }
  appendFileSync(file, JSON.stringify(line) + '\n')
}

// When a call finishes, pass the time it started:
//   log({ type: 'model.call', ts: started.toISOString(), step, provider: 'anthropic', model,
//         duration_ms: Date.now() - started.getTime(), status: 'ok', output, usage })
```

The same in Python:

```python
import json, time, uuid
from datetime import datetime, timezone

FILE = f"run-{int(time.time())}.jsonl"
RUN_ID = str(uuid.uuid4())
_seq = 0

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def log(**event):
    global _seq
    _seq += 1
    line = {"run_id": RUN_ID, "id": f"e{_seq}", "ts": now(), **event}
    with open(FILE, "a") as f:
        f.write(json.dumps(line, default=str) + "\n")
```

### Worth adding next

Once the basics show up, these make the timeline more useful. Each one is a few fields; [docs/schema.md](schema.md) has the details.

| What you want to see | What to log |
|---|---|
| Where a person approved or rejected an action, and how long they took | `approval.request` before the gated tool runs, `approval.decision` when the answer comes back |
| Retries folded into one row | On the retry, `attempt` (2, 3, ...) and `retry_of` set to the `id` of the failed attempt |
| What the run was waiting on when it crashed | A `model.start` or `tool.start` line when each call begins |
| Sub-agents nested under the call that started them | An `agent.call` line, and `parent_id` set to its `id` on every event the sub-agent writes |
| Your own prices | `pricing` on `run.start` |

## If something looks wrong

- **Some lines are missing.** A line that fails validation is skipped and listed in the **Issues** panel with its line number and the reason, and the rest of the file still loads. Fix the writer and reload.
- **The run says "incomplete".** There is no `run.end` line, usually because the process stopped. That is expected for a crashed run.
- **Cost says "est." or is missing.** Trailview has no `cost_usd` in the log and estimates from its price table. Add `cost_usd`, or `pricing` on `run.start` for models it does not know.
- **An OpenTelemetry file shows nothing.** The spans probably have no `gen_ai.operation.name`. Check that your instrumentation follows the GenAI semantic conventions.
- **The file is huge.** Logs of tens of thousands of events load in well under a second; replace very large inputs or outputs with `{ "truncated": true, "bytes": n, "preview": "..." }` to keep files small.

Still stuck? [Open an issue](https://github.com/Chi944/trailview/issues) with a few lines of the log, with anything private removed.
