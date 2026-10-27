import { describe, expect, it } from 'vitest'
import { firstHit, itemMatches, parseQuery } from './search.ts'
import { at, ev, runsFrom } from '../test/helpers.ts'

const [run] = runsFrom([
  ev({ type: 'run.start', id: 's', v: 1, agent: { name: 'bot' } }),
  ev({ type: 'model.call', id: 'm1', ts: at(1), step: 3, provider: 'anthropic', model: 'claude-haiku-5-5', duration_ms: 10, status: 'ok', output: { text: 'Found it.\nThe "CSV" path\tis web/export/csv.ts' } }),
  ev({ type: 'tool.call', id: 't1', ts: at(2), step: 13, tool: 'grep', duration_ms: 10, status: 'error', input: { pattern: 'join(",")' }, error: { type: 'exit', message: 'no model found' } }),
  ev({ type: 'agent.call', id: 'a1', ts: at(3), step: 4, agent: { name: 'explorer' }, duration_ms: 10, status: 'ok', input: 'see https://example.test/x' }),
])
const items = run!.items
const ids = (query: string) => items.filter((i) => itemMatches(i, parseQuery(query))).map((i) => i.id)

describe('parseQuery', () => {
  it('splits words, keeps quoted phrases, and reads known fields', () => {
    expect(parseQuery('Export  "the CSV path" model:Haiku')).toEqual([
      { text: 'export' },
      { text: 'the csv path' },
      { field: 'model', text: 'haiku' },
    ])
  })

  it('treats an unknown prefix such as a URL scheme as text', () => {
    expect(parseQuery('https://example.test')).toEqual([{ text: 'https://example.test' }])
  })
})

describe('itemMatches', () => {
  it('needs every term, in any field, ignoring case', () => {
    expect(ids('csv')).toEqual(['m1'])
    expect(ids('csv found')).toEqual(['m1'])
    expect(ids('csv grep')).toEqual([])
  })

  it('matches phrases across line breaks, and quotes as written, not as JSON escapes', () => {
    expect(ids('"the \\"csv')).toEqual([])
    expect(ids('join(",")')).toEqual(['t1'])
    expect(ids('"it.   the"')).toEqual(['m1'])
  })

  it('does not match a phrase that spans two separate values', () => {
    // m1 has "anthropic" then "claude-haiku-5-5" as neighbouring values.
    expect(ids('"anthropic claude"')).toEqual([])
    expect(ids('anthropicclaude')).toEqual([])
  })

  it('does not match field names', () => {
    expect(ids('usage')).toEqual([])
    expect(ids('duration_ms')).toEqual([])
  })

  it('scopes field terms to that field', () => {
    expect(ids('model:haiku')).toEqual(['m1'])
    expect(ids('"no model"')).toEqual(['t1'])
    expect(ids('status:error')).toEqual(['t1'])
    expect(ids('agent:explorer')).toEqual(['a1'])
    expect(ids('type:agent')).toEqual(['a1'])
  })

  it('compares numbers whole', () => {
    expect(ids('step:3')).toEqual(['m1'])
  })

  it('reads a URL as text', () => {
    expect(ids('https://example.test')).toEqual(['a1'])
  })
})

describe('firstHit', () => {
  it('says where the match is and cuts the text around it', () => {
    const hit = firstHit(items.find((i) => i.id === 'm1')!, parseQuery('csv'), 6)
    expect(hit).toEqual({ path: 'output.text', before: '… The "', match: 'CSV', after: '" path…' })
  })

  it('prefers a plain term over a field term', () => {
    const hit = firstHit(items.find((i) => i.id === 't1')!, parseQuery('tool:grep found'))
    expect(hit?.path).toBe('error.message')
  })
})
