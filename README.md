# Trailview

Trailview is an open-source viewer for AI-agent runs. Load a run log and see it as a timeline: steps, model calls, tool calls with their inputs and outputs, tokens and cost, errors and retries, and the points where a person approved or rejected an action.

It runs entirely in your browser, locally or as a static site. There is no account, no server and no API key, and your logs never leave your machine.

![Loading a sample run, opening a step with the keyboard, then filtering to approvals](docs/media/demo.gif)

**Live demo:** [chi944.github.io/trailview](https://chi944.github.io/trailview/). In the demo you pick a sample run or drop your own log file; it is read in the tab and never uploaded.

## Quick start

Open the demo and drop a log file on it, or run it locally:

```sh
git clone https://github.com/Chi944/trailview
cd trailview
npm install
npm run dev
```

Then open http://localhost:5173 and load a file. Press `?` for keyboard shortcuts: `j`/`k` move, `Enter` opens a step, `e` toggles errors only, `/` searches.

## Log format

Trailview reads three formats and detects which one a file is from its content:

- its own JSONL format, one JSON event per line;
- OpenTelemetry traces exported as OTLP JSON that follow the GenAI semantic conventions;
- LangSmith run exports from LangChain and LangGraph agents, as returned by the LangSmith SDK's `list_runs`.

See [docs/schema.md](docs/schema.md) for the format and both mappings, and [samples/](samples/) for example runs.

If your agent can crash or be killed, also write a `model.start` or `tool.start` line when each call begins. A call that never finishes then shows as **unfinished**, so you can see what the run was waiting on when it stopped. The sample "Data backfill agent" shows one.

## Comparing runs

Press **Compare** above a run to put it next to another run: one from the same file, another file, or a sample. Trailview lines up the steps by the models and tools they called, so a step one run added or skipped does not shift the rest, and it shows the first point where the runs differ along with the change in cost, tokens, duration, retries, errors and approval wait. The sample "Two runs to compare" shows v0.4.2 and v0.4.3 of the on-call digest agent.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests (Vitest) |
| `npm run e2e` | Run the browser tests, including an axe accessibility scan (Playwright) |
| `npm run typecheck` | Type-check with TypeScript |
| `npm run lint` | Lint with ESLint |
| `npm run build` | Build the static site into `dist/` |

## Licence

[MIT](LICENSE)
