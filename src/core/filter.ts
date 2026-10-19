import type { ParsedEvent } from './parse/jsonl.ts'
import type { TimelineItem } from './derive/retries.ts'

export const CATEGORIES = ['model', 'tool', 'approval', 'error', 'log', 'run', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  model: 'Model calls',
  tool: 'Tool calls',
  approval: 'Approvals',
  error: 'Errors',
  log: 'Logs',
  run: 'Run start/end',
  other: 'Other',
}

export interface Filters {
  hidden: Category[]
  errorsOnly: boolean
  text: string
}

export const NO_FILTERS: Filters = { hidden: [], errorsOnly: false, text: '' }

export function categoryOf(parsed: ParsedEvent): Category {
  if (parsed.kind === 'unknown') return 'other'
  switch (parsed.event.type) {
    case 'model.call':
      return 'model'
    case 'tool.call':
      return 'tool'
    case 'approval.request':
    case 'approval.decision':
      return 'approval'
    case 'error':
      return 'error'
    case 'log':
      return 'log'
    case 'run.start':
    case 'run.end':
      return 'run'
  }
}

export function isErrorEvent(parsed: ParsedEvent): boolean {
  if (parsed.kind !== 'known') return false
  const event = parsed.event
  switch (event.type) {
    case 'model.call':
    case 'tool.call':
      return event.status === 'error'
    case 'error':
      return true
    case 'run.end':
      return event.status === 'failed'
    default:
      return false
  }
}

export function itemHasError(item: TimelineItem): boolean {
  return item.events.some(isErrorEvent)
}

export function matchesFilters(item: TimelineItem, filters: Filters): boolean {
  const first = item.events[0]!
  if (filters.hidden.includes(categoryOf(first))) return false
  if (filters.errorsOnly && !itemHasError(item)) return false
  const text = filters.text.trim().toLowerCase()
  if (text && !item.events.some((e) => JSON.stringify(e.event).toLowerCase().includes(text))) return false
  return true
}
