import type { TimelineItem } from '../../core/derive/retries.ts'
import type { StepGroup } from './groups.ts'

// Flat layout for long timelines, which render only the rows in view.
// Every header and row has a fixed height, so positions are prefix sums.

export type Entry = { kind: 'header'; group: StepGroup } | { kind: 'row'; group: StepGroup; item: TimelineItem }

export interface Layout {
  entries: Entry[]
  // Top of each entry in px, plus the total height as the last element.
  tops: number[]
  // Index of each row's entry, by item id.
  indexById: Map<string, number>
}

export function layoutEntries(groups: StepGroup[], collapsed: string[], headerHeight: number, rowHeight: number): Layout {
  const entries: Entry[] = []
  const tops: number[] = []
  const indexById = new Map<string, number>()
  let y = 0
  for (const group of groups) {
    if (group.items.length === 0) continue
    entries.push({ kind: 'header', group })
    tops.push(y)
    y += headerHeight
    if (collapsed.includes(group.key)) continue
    for (const item of group.items) {
      indexById.set(item.id, entries.length)
      entries.push({ kind: 'row', group, item })
      tops.push(y)
      y += rowHeight
    }
  }
  tops.push(y)
  return { entries, tops, indexById }
}

// Entries overlapping [scrollTop, scrollTop + height], widened by `overscan` entries each side.
export function visibleRange(tops: number[], scrollTop: number, height: number, overscan = 8): { start: number; end: number } {
  const count = tops.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const start = Math.max(0, lastAtOrBefore(tops, scrollTop, count) - overscan)
  const end = Math.min(count, lastAtOrBefore(tops, scrollTop + height, count) + 1 + overscan)
  return { start, end }
}

// Largest index i < count with tops[i] <= y, or 0.
function lastAtOrBefore(tops: number[], y: number, count: number): number {
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tops[mid]! <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

// The scrollTop that brings [top, bottom] into view, or undefined when it already is.
export function scrollToReveal(top: number, bottom: number, scrollTop: number, height: number, stickyTop = 0): number | undefined {
  if (top < scrollTop + stickyTop) return Math.max(0, top - stickyTop)
  if (bottom > scrollTop + height) return bottom - height
  return undefined
}
