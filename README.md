# Trailview

[![CI](https://github.com/Chi944/trailview/actions/workflows/ci.yml/badge.svg)](https://github.com/Chi944/trailview/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Chi944/trailview)](https://github.com/Chi944/trailview/releases)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**See what your AI agent actually did.** Trailview is an open-source viewer for AI-agent runs. Load a run log and read it as a timeline: steps, model calls, tool calls with their inputs and outputs, tokens and cost, errors and retries, and the points where a person approved or rejected an action. Put two runs side by side to see where they diverged.

It runs entirely in your browser, locally or as a static site. There is no account, no server and no API key, and your logs never leave your machine.

![Opening a run with sub-agents, stepping into one with the keyboard, showing the cost breakdown, searching every event for "comma", then comparing two versions of an agent](docs/media/demo.gif)

**[Open the live demo](https://chi944.github.io/trailview/)** and pick a sample run, or drop in your own log. The file is read in the tab and never uploaded.

## Features

- **Three input formats**, detected from the content: Trailview's own [JSONL format](docs/schema.md), OpenTelemetry traces that follow the GenAI semantic conventions, and LangSmith exports from LangChain and LangGraph.
- **Timeline and detail panel** for every step, model call, tool call, approval and error, with the raw event one click away.
- **Token and cost totals**, with a breakdown per model and per sub-agent.
- **Approvals**: who approved or rejected each action, why, and how long the run waited.
- **Retries, crashes and sub-agents**: retried calls fold into one row, calls that never returned show as unfinished, and sub-agent work nests under the call that started it.
- **Search** inside every prompt, output and tool payload, with `"phrases"` and `field:value` terms.
- **Compare** two runs, aligned by the models and tools they called, with the first point of difference.
- **Shareable links** to any event, and **Markdown export** for issues and pull requests.
- **Keyboard first**, and fast: a 20,000-event log loads in about half a second.

## Quick start

Open the [demo](https://chi944.github.io/trailview/) and drop a log file on it, or run it locally (Node 20 or later):

```sh
git clone https://github.com/Chi944/trailview
cd trailview
npm install
npm run dev
```

Then open http://localhost:5173 and load a file. Press `?` for keyboard shortcuts: `j`/`k` move, `Enter` opens a step, `e` toggles errors only, `/` searches, `c` shows the cost breakdown, `u` the approvals audit trail, and `a` jumps to the approvals lane.

**Using your own agent?** [Try Trailview on your own logs](docs/your-own-logs.md) walks through exporting OpenTelemetry or LangSmith traces, or adding a ten-line logger that writes Trailview's format.

## Log format

Trailview reads three formats and detects which one a file is from its content:

- its own JSONL format, one JSON event per line;
- OpenTelemetry traces exported as OTLP JSON that follow the GenAI semantic conventions;
- LangSmith run exports from LangChain and LangGraph agents, as returned by the LangSmith SDK's `list_runs`.

See [docs/schema.md](docs/schema.md) for the format and both mappings, [samples/](samples/) for example runs, and [docs/your-own-logs.md](docs/your-own-logs.md) for how to get your own runs in.

If your agent can crash or be killed, also write a `model.start` or `tool.start` line when each call begins. A call that never finishes then shows as **unfinished**, so you can see what the run was waiting on when it stopped. The sample "Data backfill agent" shows one.

## Sub-agents

When an agent hands work to a sub-agent, log an `agent.call` and set `parent_id` on the sub-agent's events. Trailview lists that work under the call that started it, indented and foldable, with its own token and cost totals; sub-agents can nest inside sub-agents. OpenTelemetry traces with nested `invoke_agent` spans show the same way. The sample "Coding lead with sub-agents" shows two levels.

## Searching

The search box looks inside every event: prompts, model output, tool inputs and outputs, errors and approvals. All words must appear, `"quoted phrases"` match as written, even across line breaks, and `field:value` narrows a term to one field: `model:`, `provider:`, `tool:`, `agent:`, `status:`, `type:`, `step:`, `id:`, `level:` or `action:`. For example `tool:grep "no matches"` or `agent:explorer status:error`. Each result shows where it matched, such as `output.text`, with the match highlighted, and when the file holds several runs, Trailview lists the other runs that also match so you can jump to them. Enter and Shift+Enter in the search box, or `n` and `N` elsewhere, move between matches. When a match sits inside a sub-agent, the sub-agent rows above it stay in view, greyed out. The search is part of the link in the address bar, so a shared link opens with it.

## Cost breakdown

Press **Cost breakdown** under the totals, or `c`, to see where the tokens and money went: per model, and when the run used sub-agents, per agent. An agent's own cost leaves out the sub-agents it called and a last column adds them back, so the own costs add up to the run total. Every attempt of a retried call counts. Markdown exports include the same breakdown.

## Approvals and audit trail

When a run paused for a person, a lane above the timeline shows each approval as a bar from the request to the decision: green for approved, red for rejected, amber for still pending, striped when something needs a look. Click a bar, or press `a` and move with the arrow keys, to open that approval. Press **Audit trail**, or `u`, for a table of every approval: when it was asked, the step, the action and policy, who decided (a person or a policy), the reason, how long it waited and what ran afterwards. It flags a tool that ran after a rejection, a decision with no request, and a request that was never answered. Markdown exports include the audit trail for the whole run, whatever the filters.

## Comparing runs

Press **Compare** above a run to put it next to another run: one from the same file, another file, or a sample. Trailview lines up the steps by the models and tools they called, so a step one run added or skipped does not shift the rest, and it shows the first point where the runs differ along with the change in cost, tokens, duration, retries, errors and approval wait. The sample "Two runs to compare" shows v0.4.2 and v0.4.3 of the on-call digest agent.

## Linking to a step

The address bar always points at what you are looking at: the file, the run and the open event. Press **Copy link** on an event to share it. The log never goes in the link, only its file name and the run and event ids, so a teammate opens the link, then opens their copy of the same file, and Trailview jumps to the event. Links to a bundled sample open on their own, for example [`#sample=dev-lead-subagents.jsonl&run=run_lead_8d41&event=e008`](https://chi944.github.io/trailview/#sample=dev-lead-subagents.jsonl&run=run_lead_8d41&event=e008).

## Exporting to Markdown

**Copy as Markdown** puts the run's totals and the events you are looking at into a Markdown table, ready to paste into an issue or a pull request; **Download .md** saves the same text. The filters apply, so turning on **Errors only** first exports just the failures. Each row has the event id, and the export ends with a link back to the run (for your own file, the reader opens the same file to follow it).

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests (Vitest) |
| `npm run e2e` | Run the browser tests, including an axe accessibility scan (Playwright) |
| `npm run typecheck` | Type-check with TypeScript |
| `npm run lint` | Lint with ESLint |
| `npm run build` | Build the static site into `dist/` |
| `node scripts/record-demo.mjs` | Re-record the README GIF against `npm run preview -- --port 4173` (needs ffmpeg) |

## Contributing

Issues and pull requests are welcome. Please run `npm test`, `npm run typecheck` and `npm run lint` before opening a pull request, and add a test with any parser change. If a log of yours does not load as you expect, [open an issue](https://github.com/Chi944/trailview/issues) with a few lines of it, with anything private removed.

## Licence

[MIT](LICENSE)
