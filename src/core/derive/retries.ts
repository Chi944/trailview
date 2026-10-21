import type { ParsedEvent } from '../parse/jsonl.ts'

// One row on the timeline. Most rows hold a single event; a retried call holds
// every attempt in order, with the first attempt deciding where the row sits.
export interface TimelineItem {
  id: string
  events: ParsedEvent[]
  // Set by nestItems: how deep the row sits under sub-agents, the item it
  // is nested under, the step of its top-level ancestor (which decides its
  // step group), and how many items are nested under it at any depth.
  depth?: number
  parentItemId?: string
  rootStep?: number
  descendants?: number
}

export function lastEvent(item: TimelineItem): ParsedEvent {
  return item.events[item.events.length - 1]!
}

// Folds retry chains (retry_of pointing at an earlier attempt) into one item.
// Expects events already in timeline order. A retry_of that points at nothing
// in the run leaves the event as its own row.
export function foldRetries(events: ParsedEvent[]): TimelineItem[] {
  const items: TimelineItem[] = []
  const itemByEventId = new Map<string, TimelineItem>()

  for (const parsed of events) {
    const event = parsed.event
    const retryOf = retryTarget(parsed)
    const chain = retryOf ? itemByEventId.get(retryOf) : undefined
    if (chain) {
      chain.events.push(parsed)
      itemByEventId.set(event.id, chain)
      continue
    }
    const item: TimelineItem = { id: event.id, events: [parsed] }
    items.push(item)
    itemByEventId.set(event.id, item)
  }
  return items
}

function retryTarget(parsed: ParsedEvent): string | undefined {
  if (parsed.kind !== 'known') return undefined
  const event = parsed.event
  return event.type === 'model.call' || event.type === 'tool.call' ? event.retry_of : undefined
}
