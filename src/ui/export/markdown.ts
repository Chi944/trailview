import type { Run } from '../../core/model/run.ts'
import type { TimelineItem } from '../../core/derive/retries.ts'
import { CATEGORY_LABELS, NO_FILTERS, isErrorEvent, itemHasError, type Filters } from '../../core/filter.ts'
import { isUnfinished } from '../../core/derive/starts.ts'
import { describeEvent } from '../timeline/describe.ts'
import { groupItems, itemSpan } from '../timeline/groups.ts'
import { formatDuration, formatTokens, formatUsd } from '../format.ts'

export interface MarkdownInput {
  run: Run
  fileName: string
  filters?: Filters
  // A link back to this run in Trailview, when there is one to give.
  link?: string
}

const DETAIL_MAX = 140

// A run summary and its events as a Markdown table, for pasting into an issue
// or a pull request. Only the filters apply: collapsed steps and folded
// sub-agents are still exported, since folding is just for reading.
export function runMarkdown({ run, fileName, filters = NO_FILTERS, link }: MarkdownInput): string {
  const items = groupItems(run.items, filters).flatMap((g) => g.items)
  const t = run.totals
  const agent = run.agent ? `${run.agent.name}${run.agent.version ? ` ${run.agent.version}` : ''}` : undefined
  const lines = [
    `### ${agent ? `${cell(agent)} · ` : ''}\`${run.id}\` ${run.status}`,
    '',
    `${cell(fileName)} · ${run.events.length ? `${new Date(run.startMs).toISOString()} · ` : ''}${formatDuration(t.wallMs)}`,
    '',
    [
      `**Cost** ${formatUsd(t.costUsd)}${t.costEstimated ? ' est.' : ''}`,
      `**Tokens** ${formatTokens(t.inputTokens)} in / ${formatTokens(t.outputTokens)} out`,
      `**Model calls** ${t.modelCalls}`,
      `**Tool calls** ${t.toolCalls}`,
      `**Retries** ${t.retries}`,
      `**Errors** ${t.errors}`,
      ...(t.approvals ? [`**Approvals** ${t.approvals} (${t.rejections} rejected, ${formatDuration(t.waitMs)} waiting)`] : []),
    ].join(' · '),
  ]
  if (run.error) lines.push('', `> **${cell(run.error.type)}**: ${cell(run.error.message)}`)

  const filtered = describeFilters(filters)
  lines.push('', filtered ? `${items.length} of ${run.items.length} events (${filtered}):` : `${run.items.length} events:`, '')
  lines.push('| Time | Step | Event | Status | Duration | Tokens | Detail |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const item of items) lines.push(row(item, run))
  if (items.length === 0) lines.push('| | | No events match these filters. | | | | |')

  lines.push('', link ? `Exported from [Trailview](${link}).` : 'Exported from Trailview.')
  return lines.join('\n') + '\n'
}

function row(item: TimelineItem, run: Run): string {
  const final = item.events[item.events.length - 1]!
  const event = final.event
  const { label, summary } = describeEvent(final)
  const { startMs, endMs } = itemSpan(item)
  const step = typeof item.events[0]!.event.step === 'number' ? String(item.events[0]!.event.step) : ''
  const nest = item.depth ? `${'↳ '.repeat(item.depth)}` : ''
  const status = isUnfinished(final) ? 'unfinished' : isErrorEvent(final) ? 'error' : itemHasError(item) ? 'ok after retry' : 'ok'
  const attempts = item.events.length > 1 ? ` (${item.events.length} attempts)` : ''
  let input = 0
  let output = 0
  for (const e of item.events) {
    if (e.kind === 'known' && e.event.type === 'model.call' && e.event.usage) {
      input += e.event.usage.input_tokens
      output += e.event.usage.output_tokens
    }
  }
  const error = event.error as { type?: string; message?: string } | undefined
  const detail = isErrorEvent(final) && error?.message ? `${error.type ? `${error.type}: ` : ''}${error.message}` : summary
  return [
    `+${formatDuration(startMs - run.startMs)}`,
    step,
    `${nest}${cell(label)} \`${event.id}\``,
    `${status}${attempts}`,
    endMs > startMs ? formatDuration(endMs - startMs) : '',
    input + output ? `${formatTokens(input)} / ${formatTokens(output)}` : '',
    cell(truncate(detail)),
  ]
    .join(' | ')
    .replace(/^/, '| ')
    .concat(' |')
}

function describeFilters(filters: Filters): string {
  const parts = []
  if (filters.errorsOnly) parts.push('errors only')
  if (filters.hidden.length) parts.push(`hiding ${filters.hidden.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(', ')}`)
  if (filters.text.trim()) parts.push(`matching "${cell(filters.text.trim())}"`)
  return parts.join('; ')
}

// Keeps text on one table row and stops it being read as Markdown.
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\`*[\]<>|])/g, '\\$1').trim()
}

function truncate(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text
}
