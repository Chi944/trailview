import type { TimelineItem } from './retries.ts'

// Puts each item whose first event has a parent_id naming another event in
// the run right after that event's row, recursively, so a sub-agent's work is
// listed under the call that started it. Items keep timeline order among
// siblings. A parent_id that names nothing in the run, or that would form a
// cycle, leaves the item at the top level.
export function nestItems(items: TimelineItem[]): TimelineItem[] {
  const itemByEventId = new Map<string, TimelineItem>()
  for (const item of items) for (const e of item.events) itemByEventId.set(e.event.id, item)

  const anchored = anchoredItems(items, itemByEventId)
  const children = new Map<string, TimelineItem[]>()
  const roots: TimelineItem[] = []
  for (const item of items) {
    const parent = anchored.has(item) ? directParent(item, itemByEventId) : undefined
    if (parent) {
      const list = children.get(parent.id) ?? []
      list.push(item)
      children.set(parent.id, list)
    } else {
      roots.push(item)
    }
  }

  // Depth-first with an explicit stack, so a very deep chain of sub-agents
  // cannot overflow the call stack.
  const out: TimelineItem[] = []
  const stack = roots
    .map((item) => ({ item, depth: 0, parentItemId: undefined as string | undefined, rootStep: stepOf(item) }))
    .reverse()
  while (stack.length > 0) {
    const { item, depth, parentItemId, rootStep } = stack.pop()!
    out.push({ ...item, depth, parentItemId, rootStep, descendants: 0 })
    const list = children.get(item.id) ?? []
    for (let i = list.length - 1; i >= 0; i--) stack.push({ item: list[i]!, depth: depth + 1, parentItemId: item.id, rootStep })
  }
  // In depth-first order an item's descendants are the rows after it, up to the next row at its depth or above.
  const open: number[] = []
  const close = (index: number, end: number) => (out[index]!.descendants = end - index - 1)
  out.forEach((item, index) => {
    while (open.length > 0 && out[open.at(-1)!]!.depth! >= item.depth!) close(open.pop()!, index)
    open.push(index)
  })
  while (open.length > 0) close(open.pop()!, out.length)
  return out
}

function directParent(item: TimelineItem, itemByEventId: Map<string, TimelineItem>): TimelineItem | undefined {
  const parentId = item.events[0]!.event.parent_id
  return typeof parentId === 'string' ? itemByEventId.get(parentId) : undefined
}

// Items whose chain of parents ends at a top-level item. An item on a cycle,
// or below one, is left out. Each item is walked once, so this stays linear
// for long chains.
function anchoredItems(items: TimelineItem[], itemByEventId: Map<string, TimelineItem>): Set<TimelineItem> {
  const known = new Map<TimelineItem, boolean>()
  for (const item of items) {
    const path: TimelineItem[] = []
    const onPath = new Set<TimelineItem>()
    let current: TimelineItem | undefined = item
    let result = true
    while (current) {
      const seen = known.get(current)
      if (seen !== undefined) {
        result = seen
        break
      }
      if (onPath.has(current)) {
        result = false
        break
      }
      path.push(current)
      onPath.add(current)
      current = directParent(current, itemByEventId)
    }
    for (const p of path) known.set(p, result)
  }
  return new Set(items.filter((item) => known.get(item)))
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
