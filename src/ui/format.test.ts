import { describe, expect, it } from 'vitest'
import { formatDuration, formatTokens, formatUsd } from './format.ts'

describe('formatDuration', () => {
  it.each([
    [840, '840 ms'],
    [2140, '2.14 s'],
    [10_000, '10 s'],
    [22_450, '22.5 s'],
    [151_030, '2 min 31 s'],
    [119_600, '2 min 0 s'],
    [3_726_000, '1 h 2 min'],
  ])('%i ms -> %s', (ms, text) => expect(formatDuration(ms)).toBe(text))
})

describe('formatUsd', () => {
  it.each([
    [0, '$0.00'],
    [0.0069, '$0.0069'],
    [0.0651, '$0.07'],
    [4.5, '$4.50'],
  ])('%f -> %s', (n, text) => expect(formatUsd(n)).toBe(text))
})

describe('formatTokens', () => {
  it('groups thousands', () => expect(formatTokens(16570)).toBe('16,570'))
})
