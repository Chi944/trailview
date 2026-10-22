import type { PriceTable } from '../pricing/prices.ts'
import type { TimelineItem } from './retries.ts'
import { callCost } from './totals.ts'

// One row of a cost breakdown: the model calls of one model, or the model
// calls one agent made itself. Every attempt counts, as in the run totals.
export interface CostRow {
  key: string
  label: string
  modelCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  // True when any part of costUsd is an estimate from the price table.
  estimated: boolean
  // Calls with usage but no logged cost and no known price.
  unpriced: number
}

export interface AgentCostRow extends CostRow {
  // 0 for the run's own agent, 1 for a sub-agent it called, and so on.
  depth: number
  // The agent.call event id, for a sub-agent.
  eventId?: string
  // This agent's cost plus every sub-agent under it, and whether any of that is estimated.
  totalUsd: number
  totalEstimated: boolean
}

function emptyRow(key: string, label: string): CostRow {
  return { key, label, modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, estimated: false, unpriced: 0 }
}

function addCalls(row: CostRow, item: TimelineItem, pricing: PriceTable): void {
  for (const parsed of item.events) {
    if (parsed.kind !== 'known' || parsed.event.type !== 'model.call') continue
    const event = parsed.event
    row.modelCalls++
    if (event.usage) {
      row.inputTokens += event.usage.input_tokens
      row.outputTokens += event.usage.output_tokens
      row.cacheReadTokens += event.usage.cache_read_tokens ?? 0
      row.cacheWriteTokens += event.usage.cache_write_tokens ?? 0
    }
    const cost = callCost(event, pricing)
    if (cost) {
      row.costUsd += cost.usd
      row.estimated ||= cost.estimated
    } else if (event.usage) {
      row.unpriced++
    }
  }
}

function modelOf(item: TimelineItem): string | undefined {
  const event = item.events[0]!
  return event.kind === 'known' && event.event.type === 'model.call' ? event.event.model : undefined
}

// Model calls grouped by model, most expensive first.
export function costByModel(items: TimelineItem[], pricing: PriceTable = {}): CostRow[] {
  const rows = new Map<string, CostRow>()
  for (const item of items) {
    const model = modelOf(item)
    if (model === undefined) continue
    const row = rows.get(model) ?? emptyRow(model, model)
    rows.set(model, row)
    addCalls(row, item, pricing)
  }
  return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd || b.modelCalls - a.modelCalls || a.label.localeCompare(b.label))
}

// Model calls grouped by the agent that made them: the run's own agent, then
// each sub-agent call in timeline order, nested sub-agents right after their
// parent. A call belongs to the nearest sub-agent above it. Expects nestItems
// output. Returns no rows when the run has no sub-agents.
export function costByAgent(items: TimelineItem[], pricing: PriceTable = {}, mainLabel = 'Main agent'): AgentCostRow[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const isAgent = (item: TimelineItem) => item.events[0]!.event.type === 'agent.call'
  if (!items.some(isAgent)) return []

  const main: AgentCostRow = { ...emptyRow('main', mainLabel), depth: 0, totalUsd: 0, totalEstimated: false }
  const rows = new Map<string, AgentCostRow>([['main', main]])
  // Each sub-agent row's parent row.
  const parentRow = new Map<AgentCostRow, AgentCostRow>()

  const owner = (item: TimelineItem): AgentCostRow => {
    let parent = item.parentItemId ? byId.get(item.parentItemId) : undefined
    while (parent && !isAgent(parent)) parent = parent.parentItemId ? byId.get(parent.parentItemId) : undefined
    return parent ? rows.get(parent.id)! : main
  }

  for (const item of items) {
    // nestItems lists a parent before its children, so the owner row already exists.
    const parent = owner(item)
    if (isAgent(item)) {
      const event = item.events[0]!.event
      const name = (event.agent as { name?: string } | undefined)?.name ?? 'sub-agent'
      const row: AgentCostRow = { ...emptyRow(item.id, name), depth: parent.depth + 1, eventId: event.id, totalUsd: 0, totalEstimated: false }
      rows.set(item.id, row)
      parentRow.set(row, parent)
    }
    addCalls(parent, item, pricing)
  }

  for (const row of rows.values()) {
    for (let r: AgentCostRow | undefined = row; r; r = parentRow.get(r)) {
      r.totalUsd += row.costUsd
      r.totalEstimated ||= row.estimated
    }
  }
  return [...rows.values()]
}
