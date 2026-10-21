import type { TimelineItem } from '../../core/derive/retries.ts'
import { lastEvent } from '../../core/derive/retries.ts'
import { itemHasError, matchesFilters, type Filters } from '../../core/filter.ts'

export interface StepGroup {
  key: string
  step?: number
  // Items in this group that pass the filters.
  items: TimelineItem[]
  total: number
  startMs: number
  endMs: number
  inputTokens: number
  outputTokens: number
  errors: number
  // Items hidden because a sub-agent row above them is folded.
  folded: number
}

// Key in the collapsed list for a folded sub-agent row.
export const foldKey = (itemId: string) => `sub:${itemId}`

// Groups consecutive items that share a step. Keys come from the unfiltered
// list so a collapsed group stays collapsed while filters change. Items under
// a folded sub-agent row (a `sub:<id>` key in `collapsed`) are left out.
export function groupItems(items: TimelineItem[], filters: Filters, collapsed: string[] = []): StepGroup[] {
  const groups: StepGroup[] = []
  const seen = new Map<string, number>()
  let current: StepGroup | undefined
  const folded = new Set(collapsed.filter((k) => k.startsWith('sub:')).map((k) => k.slice(4)))
  const hidden = new Set<string>()

  for (const item of items) {
    const step = stepOf(item)
    if (!current || current.step !== step) {
      const base = step === undefined ? 'run' : `step-${step}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      current = {
        key: n ? `${base}-${n}` : base,
        step,
        items: [],
        total: 0,
        startMs: Infinity,
        endMs: -Infinity,
        inputTokens: 0,
        outputTokens: 0,
        errors: 0,
        folded: 0,
      }
      groups.push(current)
    }
    current.total++
    const { startMs, endMs } = itemSpan(item)
    current.startMs = Math.min(current.startMs, startMs)
    current.endMs = Math.max(current.endMs, endMs)
    for (const e of item.events) {
      if (e.kind === 'known' && e.event.type === 'model.call' && e.event.usage) {
        current.inputTokens += e.event.usage.input_tokens
        current.outputTokens += e.event.usage.output_tokens
      }
    }
    if (itemHasError(item)) current.errors++
    if (item.parentItemId && (hidden.has(item.parentItemId) || folded.has(item.parentItemId))) {
      hidden.add(item.id)
      current.folded++
    } else if (matchesFilters(item, filters)) {
      current.items.push(item)
    }
  }
  return groups
}

export function stepOf(item: TimelineItem): number | undefined {
  if (item.depth) return item.rootStep
  const step = item.events[0]!.event.step
  return typeof step === 'number' ? step : undefined
}

// From the first attempt's start to the last attempt's end.
export function itemSpan(item: TimelineItem): { startMs: number; endMs: number } {
  const first = item.events[0]!.event
  const last = lastEvent(item).event
  const lastDuration = typeof last.duration_ms === 'number' ? last.duration_ms : 0
  return { startMs: Date.parse(first.ts), endMs: Date.parse(last.ts) + lastDuration }
}

// Visible row ids in order, skipping collapsed groups.
export function visibleIds(groups: StepGroup[], collapsed: string[]): string[] {
  return groups.filter((g) => !collapsed.includes(g.key)).flatMap((g) => g.items.map((i) => i.id))
}

// Moves the selection by `delta` rows among visible ids. When the current
// selection is hidden (collapsed or filtered out), it starts from where that
// item sits in the full order.
export function moveSelection(
  groups: StepGroup[],
  collapsed: string[],
  selectedId: string | undefined,
  delta: number,
): string | undefined {
  const visible = visibleIds(groups, collapsed)
  if (visible.length === 0) return selectedId
  if (selectedId === undefined) return delta >= 0 ? visible[0] : visible[visible.length - 1]
  const index = visible.indexOf(selectedId)
  if (index >= 0) return visible[clamp(index + delta, visible.length)]

  const all = groups.flatMap((g) => g.items.map((i) => i.id))
  const pos = all.indexOf(selectedId)
  const ahead = all.slice(pos + 1).find((id) => visible.includes(id))
  const behind = all.slice(0, Math.max(pos, 0)).reverse().find((id) => visible.includes(id))
  return delta >= 0 ? (ahead ?? behind) : (behind ?? ahead)
}

export function groupKeyOf(groups: StepGroup[], itemId: string): string | undefined {
  return groups.find((g) => g.items.some((i) => i.id === itemId))?.key
}

function clamp(i: number, length: number): number {
  return Math.min(Math.max(i, 0), length - 1)
}
