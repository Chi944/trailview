import type { ParsedEvent } from '../parse/jsonl.ts'
import { estimateCost, findPrice, type PriceTable } from '../pricing/prices.ts'
import type { ModelCallEvent } from '../schema/events.ts'
import type { Approval } from './approvals.ts'

export interface Totals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  // True when any part of costUsd came from the price table rather than the log.
  costEstimated: boolean
  // Model calls with usage but no logged cost and no known price.
  unpricedCalls: number
  modelCalls: number
  toolCalls: number
  // Extra attempts beyond the first, across all retry chains.
  retries: number
  errors: number
  approvals: number
  rejections: number
  waitMs: number
  wallMs: number
}

// Every attempt counts toward tokens and cost, because it was really spent.
export function computeTotals(
  events: ParsedEvent[],
  approvals: Approval[],
  wallMs: number,
  pricing: PriceTable = {},
): Totals {
  const totals: Totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    costEstimated: false,
    unpricedCalls: 0,
    modelCalls: 0,
    toolCalls: 0,
    retries: 0,
    errors: 0,
    approvals: approvals.filter((a) => a.request).length,
    rejections: approvals.filter((a) => a.outcome === 'rejected').length,
    waitMs: approvals.reduce((sum, a) => sum + (a.waitMs ?? 0), 0),
    wallMs,
  }

  for (const parsed of events) {
    if (parsed.kind !== 'known') continue
    const event = parsed.event
    switch (event.type) {
      case 'model.call': {
        totals.modelCalls++
        if (event.retry_of) totals.retries++
        if (event.status === 'error') totals.errors++
        const usage = event.usage
        if (usage) {
          totals.inputTokens += usage.input_tokens
          totals.outputTokens += usage.output_tokens
          totals.cacheReadTokens += usage.cache_read_tokens ?? 0
          totals.cacheWriteTokens += usage.cache_write_tokens ?? 0
        }
        const cost = callCost(event, pricing)
        if (cost) {
          totals.costUsd += cost.usd
          totals.costEstimated ||= cost.estimated
        } else if (usage) {
          totals.unpricedCalls++
        }
        break
      }
      case 'tool.call':
        totals.toolCalls++
        if (event.retry_of) totals.retries++
        if (event.status === 'error') totals.errors++
        break
      case 'error':
        totals.errors++
        break
    }
  }
  return totals
}

// Cost of one model call: the logged cost_usd, else an estimate from usage and
// the price table, else undefined.
export function callCost(event: ModelCallEvent, pricing: PriceTable = {}): { usd: number; estimated: boolean } | undefined {
  if (event.cost_usd !== undefined) return { usd: event.cost_usd, estimated: false }
  if (!event.usage) return undefined
  const price = findPrice(event.model, pricing)
  if (!price) return undefined
  return { usd: estimateCost(price, event.usage.input_tokens, event.usage.output_tokens), estimated: true }
}
