# Trailview

Trailview is an open-source viewer for AI-agent runs. Load a run log and see it as a timeline: steps, model calls, tool calls with their inputs and outputs, tokens and cost, errors and retries, and the points where a person approved or rejected an action.

It runs entirely in your browser, locally or as a static site. There is no account, no server and no API key, and your logs never leave your machine.

> Status: early development. The demo link and a GIF will appear here with the first release.

## Quick start

```sh
git clone https://github.com/Chi944/trailview
cd trailview
npm install
npm run dev
```

## Log format

Trailview reads JSONL: one JSON event per line. See [docs/schema.md](docs/schema.md) for the format and [samples/](samples/) for example runs. OpenTelemetry GenAI traces are planned next.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | Type-check with TypeScript |
| `npm run lint` | Lint with ESLint |
| `npm run build` | Build the static site into `dist/` |

## Licence

[MIT](LICENSE)
