import type { ParsedEvent } from '../../core/parse/jsonl.ts'
import { formatTokens } from '../format.ts'

// One-line text for a timeline row.
export function describeEvent(parsed: ParsedEvent): { label: string; summary: string } {
  if (parsed.kind === 'unknown') return { label: parsed.event.type, summary: '' }
  const event = parsed.event
  switch (event.type) {
    case 'run.start':
      return { label: 'Run started', summary: preview(event.input) }
    case 'run.end':
      return { label: `Run ${event.status}`, summary: event.error?.message ?? preview(event.output) }
    case 'model.call': {
      const tools = event.output?.tool_calls?.map((c) => c.name) ?? []
      const parts = [
        event.usage && `${formatTokens(event.usage.input_tokens)} in / ${formatTokens(event.usage.output_tokens)} out`,
        tools.length ? `requests ${tools.join(', ')}` : event.output?.text && preview(event.output.text),
        event.error?.message,
      ]
      return { label: event.model, summary: parts.filter(Boolean).join(' · ') }
    }
    case 'tool.call':
      return { label: event.tool, summary: event.error?.message ?? preview(event.output) }
    // Start lines are folded into their calls when a run is built; these
    // cases only cover a start shown on its own.
    case 'model.start':
      return { label: event.model, summary: 'started' }
    case 'tool.start':
      return { label: event.tool, summary: 'started' }
    case 'agent.call':
      return { label: `Sub-agent: ${event.agent.name}`, summary: event.error?.message ?? preview(event.output ?? event.input) }
    case 'approval.request':
      return { label: 'Approval requested', summary: event.summary }
    case 'approval.decision': {
      const who = event.by.name ?? event.by.kind
      const verb = event.decision === 'approved' ? 'Approved' : 'Rejected'
      return { label: `${verb} by ${who}`, summary: event.reason ?? '' }
    }
    case 'error':
      return { label: `Error: ${event.error.type}`, summary: event.error.message }
    case 'log':
      return { label: `Log${event.level ? ` (${event.level})` : ''}`, summary: event.message }
  }
}

export function preview(value: unknown, max = 120): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}
