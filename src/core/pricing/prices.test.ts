import { describe, expect, it } from 'vitest'
import { estimateCost, findPrice } from './prices.ts'

describe('findPrice', () => {
  const table = { 'gpt-4o': { input_per_mtok: 2, output_per_mtok: 8 }, 'gpt-4o-mini': { input_per_mtok: 1, output_per_mtok: 1 } }

  it('prefers an exact match', () => {
    expect(findPrice('gpt-4o', {}, table)?.input_per_mtok).toBe(2)
  })

  it('uses the longest matching prefix', () => {
    expect(findPrice('gpt-4o-mini-2024-07-18', {}, table)?.input_per_mtok).toBe(1)
  })

  it('checks overrides first', () => {
    expect(findPrice('gpt-4o', { 'gpt-4o': { input_per_mtok: 9, output_per_mtok: 9 } }, table)?.input_per_mtok).toBe(9)
  })

  it('returns undefined for unknown models', () => {
    expect(findPrice('nope', {}, table)).toBeUndefined()
  })

  // Found by the parser fuzz tests: these names used to return Object.prototype members and a NaN cost.
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('does not treat %s as a priced model', (model) => {
    expect(findPrice(model, {}, table)).toBeUndefined()
  })
})

describe('estimateCost', () => {
  it('prices per million tokens', () => {
    expect(estimateCost({ input_per_mtok: 3, output_per_mtok: 15 }, { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.021, 9)
  })

  it('uses explicit cache prices when the model has them', () => {
    const price = { input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.2, cache_write_per_mtok: 5 }
    const usage = { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 10_000, cache_write_tokens: 2000 }
    // 0.004 + 0.01 + 0.002 + 0.01
    expect(estimateCost(price, usage)).toBeCloseTo(0.026, 9)
  })

  it('falls back to 0.1x input for cache reads and 1.25x input for cache writes', () => {
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 }
    expect(estimateCost({ input_per_mtok: 3, output_per_mtok: 15 }, usage)).toBeCloseTo(0.3 + 3.75, 9)
  })

  it('bundles cache prices for current Claude models', () => {
    expect(findPrice('claude-opus-5-5')?.cache_read_per_mtok).toBe(0.2)
    expect(findPrice('claude-sonnet-5-5')?.cache_write_per_mtok).toBe(2.5)
    expect(findPrice('claude-fable-5-1')?.cache_read_per_mtok).toBe(0.25)
  })
})
