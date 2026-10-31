import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { parseLog } from './detect.ts'
import { parseJsonl } from './jsonl.ts'
import { parseOtlp } from './otel.ts'
import { parseLangSmith } from './langsmith.ts'
import { buildRuns } from '../model/run.ts'
import { KNOWN_EVENT_TYPES } from '../schema/events.ts'
import JSONL_SAMPLE from '../../../samples/dev-lead-subagents.jsonl?raw'
import OTLP_TEXT from '../../../samples/otel-support-refund.json?raw'
import LANGSMITH_TEXT from '../../../samples/langsmith-sql-analyst.json?raw'

// Property tests for the three importers. Logs come from other people's
// tools, so a broken or hostile file must never throw: the parser reports
// issues and the viewer still builds runs from whatever was valid.

const OTLP_SAMPLE = JSON.parse(OTLP_TEXT) as unknown
const LANGSMITH_SAMPLE = JSON.parse(LANGSMITH_TEXT) as unknown

// FUZZ_RUNS=5000 npm test runs a longer search locally.
const RUNS = Number(import.meta.env.FUZZ_RUNS ?? 200)

// Values that have broken parsers before or sit on a boundary: huge and
// negative numbers, timestamps past the Date range, empty and odd strings.
const awkward = fc.constantFrom<unknown>(
  null,
  0,
  -1,
  1e300,
  -1e300,
  Number.MAX_SAFE_INTEGER,
  '',
  ' ',
  '99999999999999999999999999',
  '-99999999999999999999999999',
  '1e400',
  'not-a-date',
  '+275760-09-13T00:00:00.001Z',
  '__proto__',
  'constructor',
  [],
  {},
  [null],
  { __proto__: null },
  ...KNOWN_EVENT_TYPES,
)
const anyJson = fc.oneof({ weight: 1, arbitrary: awkward }, { weight: 2, arbitrary: fc.jsonValue({ maxDepth: 3 }) })

type Path = (string | number)[]

function paths(value: unknown, prefix: Path = [], out: Path[] = []): Path[] {
  out.push(prefix)
  if (Array.isArray(value)) value.forEach((v, i) => paths(v, [...prefix, i], out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) paths(v, [...prefix, k], out)
  return out
}

// Returns a copy of value with the node at path replaced, or deleted when replacement is DELETE.
const DELETE = Symbol('delete')
function setAt(value: unknown, path: Path, replacement: unknown): unknown {
  if (path.length === 0) return replacement === DELETE ? undefined : replacement
  const [head, ...rest] = path
  if (Array.isArray(value)) {
    const copy = [...value]
    if (rest.length === 0 && replacement === DELETE) copy.splice(head as number, 1)
    else copy[head as number] = setAt(copy[head as number], rest, replacement)
    return copy
  }
  const copy: Record<string, unknown> = { ...(value as object) }
  if (rest.length === 0 && replacement === DELETE) delete copy[head!]
  else copy[head!] = setAt(copy[head!], rest, replacement)
  return copy
}

// A structurally valid document with a few nodes replaced or removed.
function mutated(doc: unknown) {
  const all = paths(doc)
  const edit = fc.tuple(fc.nat({ max: all.length - 1 }), fc.oneof(anyJson, fc.constant(DELETE)))
  return fc.array(edit, { minLength: 1, maxLength: 4 }).map((edits) =>
    edits.reduce<unknown>((acc, [index, replacement]) => {
      // Earlier edits can remove a path; skip edits whose parent is gone.
      const path = all[index]!
      const parent = path.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], acc)
      return parent === undefined || (typeof parent !== 'object' && path.length > 0) ? acc : setAt(acc, path, replacement)
    }, doc),
  )
}

// What every importer promises, whatever the input.
function checkResult(text: string, result: ReturnType<typeof parseJsonl>) {
  const lineCount = Math.max(1, text.split(/\r?\n/).length)
  for (const issue of result.issues) {
    expect(issue.line).toBeGreaterThanOrEqual(1)
    expect(issue.line).toBeLessThanOrEqual(lineCount)
    expect(typeof issue.message).toBe('string')
  }
  for (const event of result.events) {
    expect(Number.isNaN(Date.parse(event.event.ts))).toBe(false)
  }
  const runs = buildRuns(result.events)
  for (const run of runs) {
    expect(Number.isFinite(run.totals.costUsd)).toBe(true)
    expect(run.totals.inputTokens).toBeGreaterThanOrEqual(0)
  }
}

describe('parser fuzzing', { timeout: 120_000 }, () => {
  it('parseLog never throws on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (text) => {
        checkResult(text, parseLog(text))
      }),
      { numRuns: RUNS },
    )
  })

  it('parseLog never throws on arbitrary JSON, whole-file or one value per line', () => {
    fc.assert(
      fc.property(fc.array(anyJson, { minLength: 1, maxLength: 6 }), fc.boolean(), (values, perLine) => {
        const text = perLine ? values.map((v) => JSON.stringify(v) ?? '').join('\n') : JSON.stringify(values)
        checkResult(text, parseLog(text))
      }),
      { numRuns: RUNS },
    )
  })

  it('each importer survives arbitrary JSON when called directly', () => {
    fc.assert(
      fc.property(anyJson, (value) => {
        const text = JSON.stringify(value) ?? 'null'
        for (const parse of [parseJsonl, parseOtlp, parseLangSmith]) checkResult(text, parse(text))
      }),
      { numRuns: RUNS },
    )
  })

  it('JSONL: a sample with fields replaced or removed never throws', () => {
    const lines = JSONL_SAMPLE.trim().split('\n').map((l) => JSON.parse(l) as unknown)
    fc.assert(
      fc.property(mutated(lines), (doc) => {
        const text = Array.isArray(doc) ? doc.map((l) => JSON.stringify(l) ?? '').join('\n') : (JSON.stringify(doc) ?? '')
        checkResult(text, parseJsonl(text))
      }),
      { numRuns: RUNS },
    )
  })

  it('JSONL: lines cut short or shuffled never throw, and every bad line is reported', () => {
    const lines = JSONL_SAMPLE.trim().split('\n')
    fc.assert(
      fc.property(fc.shuffledSubarray(lines), fc.nat(), (picked, cut) => {
        const truncated = picked.map((l, i) => (i === 0 ? l.slice(0, cut % (l.length + 1)) : l))
        const text = truncated.join('\n')
        const result = parseJsonl(text)
        checkResult(text, result)
        expect(result.events.length + new Set(result.issues.filter((i) => i.severity === 'error').map((i) => i.line)).size).toBe(
          truncated.filter((l) => l.trim() !== '').length,
        )
      }),
      { numRuns: RUNS },
    )
  })

  it('OTel: a sample with fields replaced or removed never throws', () => {
    fc.assert(
      fc.property(mutated(OTLP_SAMPLE), fc.boolean(), (doc, pretty) => {
        const text = JSON.stringify(doc, null, pretty ? 2 : undefined) ?? 'null'
        checkResult(text, parseOtlp(text))
      }),
      { numRuns: RUNS },
    )
  })

  it('LangSmith: a sample with fields replaced or removed never throws', () => {
    fc.assert(
      fc.property(mutated(LANGSMITH_SAMPLE), (doc) => {
        const text = JSON.stringify(doc) ?? 'null'
        checkResult(text, parseLangSmith(text))
      }),
      { numRuns: RUNS },
    )
  })
})

// Shapes the random search is unlikely to build, each of which used to throw.
describe('pathological inputs', () => {
  it('LangSmith: child_runs nested 10,000 deep', () => {
    const depth = 10_000
    let text = ''
    for (let i = 0; i < depth; i++) {
      text += `{"id":"r${i}","run_type":"${i % 2 ? 'llm' : 'chain'}","start_time":"2026-10-19T14:02:11","end_time":"2026-10-19T14:02:12","name":"step"`
      if (i < depth - 1) text += ',"child_runs":['
    }
    text = `[${text}${'}]'.repeat(depth - 1)}}]`
    const result = parseLangSmith(text)
    expect(result.issues).toEqual([])
    expect(result.events.filter((e) => e.event.type === 'model.call')).toHaveLength(depth / 2)
  })

  it('OTel: times past the range a Date can hold are reported, not thrown', () => {
    const span = { traceId: 't1', spanId: 's1', startTimeUnixNano: '9'.repeat(30), endTimeUnixNano: '1', attributes: [] }
    const result = parseOtlp(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }))
    expect(result.issues.map((i) => i.message)).toEqual(['Span "?" is missing traceId, spanId or times'])
  })

  it('OTel: attributes, events and spans that are not lists are skipped', () => {
    const span = { traceId: 't1', spanId: 's1', startTimeUnixNano: '1', endTimeUnixNano: '2', attributes: {}, events: 'x' }
    const text = JSON.stringify({ resourceSpans: [null, { resource: { attributes: 7 }, scopeSpans: [{ spans: {} }, null, { spans: [span, 3] }] }] })
    expect(() => parseOtlp(text)).not.toThrow()
  })

  it('LangSmith: runs that name each other as parents', () => {
    const run = (id: string, parent: string) => ({ id, parent_run_id: parent, trace_id: 't1', run_type: 'llm', start_time: '2026-10-19T14:02:11', end_time: '2026-10-19T14:02:12', name: 'x' })
    for (const runs of [[run('a', 'b'), run('b', 'a')], [run('a', 'a')]]) {
      const result = parseLangSmith(JSON.stringify(runs))
      expect(result.issues).toEqual([])
      expect(buildRuns(result.events)).toHaveLength(1)
    }
  })

  it('LangSmith: a numeric start_time past the Date range is reported, not thrown', () => {
    const result = parseLangSmith(JSON.stringify([{ id: 'r1', run_type: 'llm', start_time: 1e300, name: 'x' }]))
    expect(result.issues.map((i) => i.message)).toEqual(['Run "x" is missing id, run_type or start_time'])
  })
})
