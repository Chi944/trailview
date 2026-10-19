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
})

describe('estimateCost', () => {
  it('prices per million tokens', () => {
    expect(estimateCost({ input_per_mtok: 3, output_per_mtok: 15 }, 2000, 1000)).toBeCloseTo(0.021, 9)
  })
})
