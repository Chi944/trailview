import type { ParsedEvent } from './parse/jsonl.ts'
import type { Run } from './model/run.ts'
import type { TimelineItem } from './derive/retries.ts'
import type { Approval } from './derive/approvals.ts'
import type { ParsedLog } from './load.ts'

// Moves a parsed log from the parse worker to the page in pieces.
//
// postMessage copies its data, and the page pays for that copy on its main
// thread when the message arrives. Sent whole, a 160 MB trace takes about two
// seconds to unpack, during which the tab cannot respond. Sent as many small
// messages, each one unpacks quickly and the page stays responsive between them.
//
// Timeline items and approvals point at the same event objects as the run's
// event list. A copy would turn each of those into a separate object, so they
// travel as positions in the event list and are pointed back after arrival.

export const EVENTS_PER_MESSAGE = 5_000

export type TransferMessage =
  | { type: 'events'; run: number; events: ParsedEvent[] }
  | { type: 'done'; format: ParsedLog['format']; issues: ParsedLog['issues']; runs: RunShape[] }

// A reference to an event: its position in the run's event list, or the object
// itself when it is not in the list.
type Ref<T> = { at: number } | { value: T }

interface ItemShape extends Omit<TimelineItem, 'events'> {
  events: number[]
}

interface ApprovalShape extends Omit<Approval, 'request' | 'decision' | 'toolCall'> {
  request?: Ref<NonNullable<Approval['request']>>
  decision?: Ref<NonNullable<Approval['decision']>>
  toolCall?: Ref<NonNullable<Approval['toolCall']>>
}

export interface RunShape extends Omit<Run, 'events' | 'items' | 'approvals'> {
  items: ItemShape[]
  approvals: ApprovalShape[]
}

export function* encodeLog(parsed: ParsedLog, perMessage = EVENTS_PER_MESSAGE): Generator<TransferMessage> {
  const runs: RunShape[] = []
  for (const [index, run] of parsed.runs.entries()) {
    for (let start = 0; start < run.events.length; start += perMessage) {
      yield { type: 'events', run: index, events: run.events.slice(start, start + perMessage) }
    }
    runs.push(encodeRun(run))
  }
  yield { type: 'done', format: parsed.format, issues: parsed.issues, runs }
}

function encodeRun(run: Run): RunShape {
  const position = new Map<ParsedEvent, number>()
  const eventPosition = new Map<unknown, number>()
  run.events.forEach((p, i) => {
    position.set(p, i)
    eventPosition.set(p.event, i)
  })
  const ref = <T>(value: T | undefined): Ref<T> | undefined => {
    if (value === undefined) return undefined
    const at = eventPosition.get(value)
    return at === undefined ? { value } : { at }
  }
  // The events travel in their own messages.
  const { events, items, approvals, ...rest } = run
  void events
  return {
    ...rest,
    items: items.map(({ events, ...item }) => ({
      ...item,
      // An event missing from the list should not happen; -1 makes it fail loudly in decodeLog.
      events: events.map((p) => position.get(p) ?? -1),
    })),
    approvals: approvals.map(({ request, decision, toolCall, ...approval }) => ({
      ...approval,
      request: ref(request),
      decision: ref(decision),
      toolCall: ref(toolCall),
    })),
  }
}

// Collects the messages encodeLog produced, in order, and rebuilds the log.
export class LogReceiver {
  private readonly events = new Map<number, ParsedEvent[]>()

  // Returns the log once the last message has arrived.
  receive(message: TransferMessage): ParsedLog | undefined {
    if (message.type === 'events') {
      const list = this.events.get(message.run)
      if (list) for (const e of message.events) list.push(e)
      else this.events.set(message.run, message.events)
      return undefined
    }
    return {
      format: message.format,
      issues: message.issues,
      runs: message.runs.map((shape, index) => decodeRun(shape, this.events.get(index) ?? [])),
    }
  }
}

function decodeRun(shape: RunShape, events: ParsedEvent[]): Run {
  const at = (i: number) => {
    const p = events[i]
    if (!p) throw new Error(`Event ${i} of run ${shape.id} did not arrive`)
    return p
  }
  const deref = <T>(ref: Ref<T> | undefined): T | undefined =>
    ref === undefined ? undefined : 'value' in ref ? ref.value : (at(ref.at).event as T)
  const { items, approvals, ...rest } = shape
  return {
    ...rest,
    events,
    items: items.map((item) => ({ ...item, events: item.events.map(at) })),
    approvals: approvals.map(({ request, decision, toolCall, ...approval }) => ({
      ...approval,
      request: deref(request),
      decision: deref(decision),
      toolCall: deref(toolCall),
    })),
  }
}
