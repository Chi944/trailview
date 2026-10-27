import type { TimelineItem } from '../../core/derive/retries.ts'
import { lastEvent } from '../../core/derive/retries.ts'
import { itemHasError, matchesFilters, queryTerms, type Filters } from '../../core/filter.ts'

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
  // Ids of items in `items` that do not match the search themselves but are
  // shown, dimmed, because work nested under them does.
  context: Set<string>
}

// Key in the collapsed list for a folded sub-agent row.
export const foldKey = (itemId: string) => `sub:${itemId}`

// Groups consecutive items that share a step. Keys come from the unfiltered
// list so a collapsed group stays collapsed while filters change. Items under
// a folded sub-agent row (a `sub:<id>` key in `collapsed`) are left out.
// While searching, a row whose nested work matches stays in as context.
export function groupItems(items: TimelineItem[], filters: Filters, collapsed: string[] = []): StepGroup[] {
  const matches = new Set(items.filter((i) => matchesFilters(i, filters)).map((i) => i.id))
  const context = queryTerms(filters.text).length ? contextIds(items, matches, filters) : new Set<string>()
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
        context: new Set(),
      }
      groups.push(current)
    }
    current.total++
    const stats = statsOf(item)
    current.startMs = Math.min(current.startMs, stats.startMs)
    current.endMs = Math.max(current.endMs, stats.endMs)
    current.inputTokens += stats.inputTokens
    current.outputTokens += stats.outputTokens
    if (stats.error) current.errors++
    if (item.parentItemId && (hidden.has(item.parentItemId) || folded.has(item.parentItemId))) {
      hidden.add(item.id)
      current.folded++
    } else if (matches.has(item.id)) {
      current.items.push(item)
    } else if (context.has(item.id)) {
      current.items.push(item)
      current.context.add(item.id)
    }
  }
  return groups
}

// What a row adds to its step's header. It does not depend on the filters, so
// it is worked out once per item rather than on every keystroke in the search box.
interface ItemStats {
  startMs: number
  endMs: number
  inputTokens: number
  outputTokens: number
  error: boolean
}

const statsCache = new WeakMap<TimelineItem, ItemStats>()

function statsOf(item: TimelineItem): ItemStats {
  let stats = statsCache.get(item)
  if (!stats) {
    stats = { ...itemSpan(item), inputTokens: 0, outputTokens: 0, error: itemHasError(item) }
    for (const e of item.events) {
      if (e.kind === 'known' && e.event.type === 'model.call' && e.event.usage) {
        stats.inputTokens += e.event.usage.input_tokens
        stats.outputTokens += e.event.usage.output_tokens
      }
    }
    statsCache.set(item, stats)
  }
  return stats
}

const byIdCache = new WeakMap<TimelineItem[], Map<string, TimelineItem>>()

// Ancestors of matching items that pass every filter but the search. Expects
// nestItems output, where a parent comes before its children.
function contextIds(items: TimelineItem[], matches: Set<string>, filters: Filters): Set<string> {
  let byId = byIdCache.get(items)
  if (!byId) {
    byId = new Map(items.map((i) => [i.id, i]))
    byIdCache.set(items, byId)
  }
  const withoutText = { ...filters, text: '' }
  const out = new Set<string>()
  for (const item of items) {
    if (!matches.has(item.id)) continue
    for (let p = item.parentItemId; p && !out.has(p); p = byId.get(p)?.parentItemId) {
      const parent = byId.get(p)
      if (parent && !matches.has(p) && matchesFilters(parent, withoutText)) out.add(p)
    }
  }
  return out
}

// Ids of the rows that match the search, in timeline order, including rows
// inside collapsed steps but not the dimmed context rows.
export function hitIds(groups: StepGroup[]): string[] {
  return groups.flatMap((g) => g.items.filter((i) => !g.context.has(i.id)).map((i) => i.id))
}

// The next (delta 1) or previous (delta -1) hit from the selection, wrapping
// around. A selection that is not a hit starts from where it sits in `order`.
export function stepHit(order: string[], hits: string[], selectedId: string | undefined, delta: 1 | -1): string | undefined {
  if (hits.length === 0) return undefined
  const hitSet = new Set(hits)
  let index = selectedId === undefined ? -1 : order.indexOf(selectedId)
  if (index < 0) index = delta > 0 ? -1 : order.length
  for (let n = 0; n < order.length; n++) {
    index = (index + delta + order.length) % order.length
    if (hitSet.has(order[index]!)) return order[index]
  }
  return undefined
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
