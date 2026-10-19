// Bundled list prices in US$ per million tokens, used only when a model.call
// has no cost_usd. Figures shown from this table are labelled "est." in the UI.
// run.start.pricing overrides any entry. Matching is exact, then longest prefix,
// so dated model ids (e.g. "gpt-4o-2024-08-06") still match.

export interface ModelPrice {
  input_per_mtok: number
  output_per_mtok: number
}

export type PriceTable = Record<string, ModelPrice>

export const BUNDLED_PRICES: PriceTable = {
  'claude-opus-4': { input_per_mtok: 15, output_per_mtok: 75 },
  'claude-sonnet-4': { input_per_mtok: 3, output_per_mtok: 15 },
  'claude-3-5-haiku': { input_per_mtok: 0.8, output_per_mtok: 4 },
  'gpt-4o-mini': { input_per_mtok: 0.15, output_per_mtok: 0.6 },
  'gpt-4o': { input_per_mtok: 2.5, output_per_mtok: 10 },
}

export function findPrice(model: string, overrides: PriceTable = {}, table: PriceTable = BUNDLED_PRICES): ModelPrice | undefined {
  return lookup(model, overrides) ?? lookup(model, table)
}

function lookup(model: string, table: PriceTable): ModelPrice | undefined {
  if (table[model]) return table[model]
  let best: string | undefined
  for (const key of Object.keys(table)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key
  }
  return best ? table[best] : undefined
}

export function estimateCost(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  return (inputTokens * price.input_per_mtok + outputTokens * price.output_per_mtok) / 1_000_000
}
