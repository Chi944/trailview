import type { TimelineItem } from './retries.ts'

// Puts each item whose first event has a parent_id naming another event in
// the run right after that event's row, recursively, so a sub-agent's work is
// listed under the call that started it. Items keep timeline order among
// siblings. A parent_id that names nothing in the run, or that would form a
// cycle, leaves the item at the top level.
export function nestItems(items: TimelineItem[]): TimelineItem[] {
  const itemByEventId = new Map<string, TimelineItem>()
  for (const item of items) for (const e of item.events) itemByEventId.set(e.event.id, item)

  const children = new Map<string, TimelineItem[]>()
  const roots: TimelineItem[] = []
  for (const item of items) {
    const parent = parentOf(item, itemByEventId)
    if (parent) {
      const list = children.get(parent.id) ?? []
      list.push(item)
      children.set(parent.id, list)
    } else {
      roots.push(item)
    }
  }

  const out: TimelineItem[] = []
  const visit = (item: TimelineItem, depth: number, parentItemId: string | undefined, rootStep: number | undefined): number => {
    const step = depth === 0 ? stepOf(item) : rootStep
    const nested: TimelineItem = { ...item, depth, parentItemId, rootStep: step, descendants: 0 }
    out.push(nested)
    let count = 0
    for (const child of children.get(item.id) ?? []) count += 1 + visit(child, depth + 1, item.id, step)
    nested.descendants = count
    return count
  }
  for (const root of roots) visit(root, 0, undefined, undefined)
  return out
}

function parentOf(item: TimelineItem, itemByEventId: Map<string, TimelineItem>): TimelineItem | undefined {
  const parentId = item.events[0]!.event.parent_id
  if (typeof parentId !== 'string') return undefined
  // Walk up to make sure the item is not its own ancestor.
  const seen = new Set([item.id])
  let current = itemByEventId.get(parentId)
  const parent = current
  while (current) {
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    const next = current.events[0]!.event.parent_id
    current = typeof next === 'string' ? itemByEventId.get(next) : undefined
  }
  return parent
}

function stepOf(item: TimelineItem): number | undefined {
  const step = item.events[0]!.event.step
  return typeof step === 'number' ? step : undefined
}

// The items nested under `itemId`, at any depth. Expects nestItems output.
export function descendantsOf(items: TimelineItem[], itemId: string): TimelineItem[] {
  const index = items.findIndex((i) => i.id === itemId)
  if (index < 0) return []
  return items.slice(index + 1, index + 1 + (items[index]!.descendants ?? 0))
}
