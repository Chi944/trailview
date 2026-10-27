# Performance on large logs

Measured on 2026-10-27 with synthetic OpenTelemetry traces from
`scripts/make-large-otel.mjs`: one agent run of alternating `chat` and
`execute_tool` spans, with a retried model call every 50 steps and an approval
every 200. Parse times are from Node 22. UI times are from headless Chromium
against `npm run build && npm run preview`, in a cloud container, so treat them
as relative rather than absolute.

```sh
node scripts/make-large-otel.mjs 200000 > /tmp/large.json             # one document
node scripts/make-large-otel.mjs 200000 --per-line > /tmp/large.jsonl # one export request per 512 spans
```

| Spans | File | Parse + build runs | Open in the viewer | Heap after load |
|---|---|---|---|---|
| 20,000 | 16 MB | 0.9 s | 1.5 s | 55 MB |
| 200,000 | 162 MB | 9.8 s | 6 to 8.5 s | 530 MB |

Parsing is linear, about 40 µs per span, and spread across `JSON.parse`, schema
validation and garbage collection with no single hot spot. The one-export-per-line
form parses at the same speed but peaks at roughly twice the memory while it
is read.

With 200,000 rows in the viewer:

| Action | Time |
|---|---|
| Move the selection with `j` / `k` | about 55 ms per key |
| First search after opening the file (builds the search index) | 2.7 s |
| Typing in the search box | about 40 ms per key |
| Results after typing stops | about 0.75 s |

## What changed to get here

- Traces above about 120,000 spans failed to load with "Maximum call stack size
  exceeded": the OTel and LangSmith importers spread every record into one
  `push()` call. They now append in a loop. A 130,000-span unit test covers it.
- Each search keystroke re-read every row's timestamps and token counts and
  checked every value of every event. Step header figures are now worked out
  once per row, each event's values are joined into one string for a quick
  first check, and on runs above 20,000 rows the timeline waits until typing
  pauses for 250 ms before filtering. Before this, each key press took about
  one second on 200,000 rows.

## Known limits

- Parsing runs on the page's main thread, so the tab does not respond while a
  file of 100 MB or more loads. Moving parsing into a Web Worker is the next step.
- Timelines above 400 visible rows render only the rows in view (see
  `src/ui/timeline/window.ts`), so row count does not limit scrolling.
