import { describe, expect, it } from 'vitest'
import sample from '../../test/schema-example.jsonl?raw'
import { parseJsonl } from '../../core/parse/jsonl.ts'
import { describeEvent, preview } from './describe.ts'

const events = new Map(parseJsonl(sample).events.map((e) => [e.event.id, e]))
const text = (id: string) => describeEvent(events.get(id)!)

describe('describeEvent', () => {
  it('summarises a model call with tokens and requested tools', () => {
    expect(text('e02')).toEqual({ label: 'claude-sonnet-5-5', summary: '1,820 in / 96 out · requests query_jobs' })
  })

  it('shows a failed tool call by its error', () => {
    expect(text('e03')).toEqual({ label: 'query_jobs', summary: 'jobs API did not respond within 10s' })
  })

  it('names who decided an approval and why', () => {
    expect(text('e07')).toEqual({ label: 'Rejected by d', summary: 'Only the on-call engineer, not the whole list.' })
  })

  it('labels the end of the run with its status', () => {
    expect(text('e13').label).toBe('Run succeeded')
  })
})

describe('preview', () => {
  it('collapses whitespace and truncates', () => {
    expect(preview('a\n  b', 10)).toBe('a b')
    expect(preview('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`)
  })

  it('stringifies objects and ignores empty values', () => {
    expect(preview({ a: 1 })).toBe('{"a":1}')
    expect(preview(undefined)).toBe('')
  })
})
