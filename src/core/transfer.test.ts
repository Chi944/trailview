import { describe, expect, it } from 'vitest'
import otel from '../../samples/otel-support-refund.json?raw'
import langsmith from '../../samples/langsmith-sql-analyst.json?raw'
import openai from '../../samples/openai-agents-support-triage.json?raw'
import subagents from '../../samples/dev-lead-subagents.jsonl?raw'
import retries from '../../samples/oncall-digest-two-versions.jsonl?raw'
import crashed from '../../samples/backfill-crashed.jsonl?raw'
import { loadLog, type ParsedLog } from './load.ts'
import { encodeLog, LogReceiver, type TransferMessage } from './transfer.ts'

// Sends a log through encodeLog, a structured clone per message (what
// postMessage does), and LogReceiver.
function roundTrip(parsed: ParsedLog, perMessage?: number): { log: ParsedLog | undefined; messages: TransferMessage[] } {
  const messages = [...encodeLog(parsed, perMessage)]
  const receiver = new LogReceiver()
  let log: ParsedLog | undefined
  for (const m of messages) log = receiver.receive(structuredClone(m)) ?? log
  return { log, messages }
}

describe('moving a parsed log from the worker to the page', () => {
  it.each([
    ['OTLP', otel],
    ['LangSmith', langsmith],
    ['OpenAI Agents', openai],
    ['JSONL with sub-agents', subagents],
    ['JSONL with two runs and retries', retries],
    ['JSONL with an unfinished call', crashed],
  ])('arrives unchanged for a %s sample', (_, text) => {
    const parsed = loadLog(text)
    expect(roundTrip(parsed, 7).log).toEqual(parsed)
  })

  it('splits the events into messages of the given size, and finishes with one done message', () => {
    const parsed = loadLog(subagents)
    const total = parsed.runs.reduce((n, r) => n + r.events.length, 0)
    const { messages } = roundTrip(parsed, 10)
    const events = messages.filter((m) => m.type === 'events')
    expect(events.every((m) => m.events.length <= 10)).toBe(true)
    expect(events.reduce((n, m) => n + m.events.length, 0)).toBe(total)
    expect(messages.filter((m) => m.type === 'done')).toHaveLength(1)
    expect(messages.at(-1)?.type).toBe('done')
  })

  it('points items and approvals back at the run’s own event objects', () => {
    const { log } = roundTrip(loadLog(otel), 3)
    const run = log!.runs[0]!
    const events = new Set(run.events)
    const raw = new Set(run.events.map((p) => p.event))
    expect(run.items.every((item) => item.events.every((p) => events.has(p)))).toBe(true)
    expect(run.approvals.length).toBeGreaterThan(0)
    for (const a of run.approvals) {
      for (const e of [a.request, a.decision, a.toolCall]) if (e) expect(raw.has(e)).toBe(true)
    }
  })

  it('keeps an empty log and its issues', () => {
    const parsed = loadLog('not json\n')
    expect(roundTrip(parsed).log).toEqual(parsed)
    expect(parsed.issues).toHaveLength(1)
  })

  it('fails loudly if an event message went missing', () => {
    const messages = [...encodeLog(loadLog(subagents), 5)]
    const receiver = new LogReceiver()
    expect(() => {
      for (const m of messages.slice(1)) receiver.receive(m)
    }).toThrow(/did not arrive/)
  })
})
