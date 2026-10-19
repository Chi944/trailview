import type { Totals } from '../../core/derive/totals.ts'
import { formatDuration, formatTokens, formatUsd } from '../format.ts'

export function TotalsBar({ totals }: { totals: Totals }) {
  const cost = `${formatUsd(totals.costUsd)}${totals.costEstimated ? ' est.' : ''}`
  const stats: [string, string, string?][] = [
    ['Tokens in', formatTokens(totals.inputTokens)],
    ['Tokens out', formatTokens(totals.outputTokens)],
    [
      'Cost',
      cost,
      totals.unpricedCalls ? `${totals.unpricedCalls} call(s) have no logged cost and no known price` : undefined,
    ],
    ['Model calls', String(totals.modelCalls)],
    ['Tool calls', String(totals.toolCalls)],
    ['Retries', String(totals.retries)],
    ['Errors', String(totals.errors)],
    ['Approvals', totals.approvals ? `${totals.approvals} (${totals.rejections} rejected)` : '0'],
    ['Waiting on people', formatDuration(totals.waitMs)],
  ]
  return (
    <dl className="totals" aria-label="Run totals">
      {stats.map(([label, value, note]) => (
        <div key={label} className="totals__item" title={note}>
          <dt>{label}</dt>
          <dd>
            {value}
            {note && <span className="totals__note"> *</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
