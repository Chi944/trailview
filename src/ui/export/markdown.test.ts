import { describe, expect, it } from 'vitest'
import subagents from '../../../samples/dev-lead-subagents.jsonl?raw'
import { parseLog } from '../../core/parse/detect.ts'
import { buildRuns } from '../../core/model/run.ts'
import { NO_FILTERS } from '../../core/filter.ts'
import { runMarkdown } from './markdown.ts'
import { at, ev, runsFrom } from '../../test/helpers.ts'

const tableRows = (md: string) => md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Time') && !l.startsWith('| ---'))

describe('runMarkdown', () => {
  const [run] = buildRuns(parseLog(subagents).events)

  it('summarises the run and lists every event, nested ones marked', () => {
    const md = runMarkdown({ run: run!, fileName: 'dev-lead-subagents.jsonl', link: 'https://x.test/#sample=dev-lead-subagents.jsonl&run=run_lead_8d41' })
    expect(md).toMatch(/^### dev-lead 3\.0\.1 · `run_lead_8d41` /)
    expect(md).toContain('**Model calls** ')
    expect(md).toContain(`${run!.items.length} events:`)
    expect(tableRows(md)).toHaveLength(run!.items.length)
    expect(md).toContain('| ↳ Sub-agent: code-search `e008` |')
    expect(md).toMatch(/\*\*Cost by model\*\* claude-opus-5-5 \$\S+ (est\. )?\(4 calls, \d+%\) · claude-haiku-5-5 /)
    expect(md).toMatch(/\*\*Cost by agent\*\* dev-lead \$\S+ .* · ↳ explorer .* · ↳ ↳ code-search .* · ↳ test-runner /)
    expect(md).toContain('Exported from [Trailview](https://x.test/#sample=dev-lead-subagents.jsonl&run=run_lead_8d41)')
  })

  it('exports only what the filters show, and says which filters', () => {
    const md = runMarkdown({ run: run!, fileName: 'f', filters: { ...NO_FILTERS, errorsOnly: true, text: 'a|b' } })
    expect(md).toContain(`0 of ${run!.items.length} events (errors only; matching "a\\|b"):`)
    expect(md).toContain('No events match these filters.')
  })

  it('shows errors, retries and tokens, and keeps cells on one line', () => {
    const [r] = runsFrom([
      ev({ type: 'run.start', id: 's', v: 1, agent: { name: 'bot' } }),
      ev({ type: 'model.call', id: 'm1', ts: at(1), step: 1, provider: 'p', model: 'm', duration_ms: 500, status: 'error', error: { type: 'overloaded', message: 'busy' }, usage: { input_tokens: 10, output_tokens: 0 } }),
      ev({ type: 'model.call', id: 'm2', ts: at(2), step: 1, provider: 'p', model: 'm', duration_ms: 1500, status: 'ok', attempt: 2, retry_of: 'm1', usage: { input_tokens: 10, output_tokens: 5 } }),
      ev({ type: 'tool.call', id: 't1', ts: at(4), step: 2, tool: 'grep', call_id: 'c', duration_ms: 200, status: 'error', error: { type: 'exit', message: 'exit 1\nsee | log' } }),
    ])
    const rows = tableRows(runMarkdown({ run: r!, fileName: 'x.jsonl' }))
    expect(rows[1]).toBe('| +1 s | 1 | m `m2` | ok after retry (2 attempts) | 2.5 s | 20 / 5 | 10 in / 5 out |')
    expect(rows[2]).toBe('| +4 s | 2 | grep `t1` | error | 200 ms |  | exit: exit 1 see \\| log |')
  })
})
