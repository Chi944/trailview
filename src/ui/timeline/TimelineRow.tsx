import type { TimelineItem } from '../../core/derive/retries.ts'
import { categoryOf, isErrorEvent, itemHasError } from '../../core/filter.ts'
import type { Approval } from '../../core/derive/approvals.ts'
import { formatDuration } from '../format.ts'
import { describeEvent } from './describe.ts'
import { itemSpan } from './groups.ts'

interface Props {
  item: TimelineItem
  runStartMs: number
  runWallMs: number
  selected: boolean
  approval?: Approval
  onClick: () => void
}

export function rowDomId(id: string): string {
  return `row-${id}`
}

export function TimelineRow({ item, runStartMs, runWallMs, selected, approval, onClick }: Props) {
  const first = item.events[0]!
  const final = item.events[item.events.length - 1]!
  const category = categoryOf(first)
  const { label, summary } = describeEvent(final)
  const { startMs, endMs } = itemSpan(item)
  const span = endMs - startMs
  const failed = itemHasError(item)
  const wall = Math.max(runWallMs, 1)
  const left = ((startMs - runStartMs) / wall) * 100
  const width = Math.max((span / wall) * 100, 0.4)

  return (
    <div
      id={rowDomId(item.id)}
      role="option"
      aria-selected={selected}
      className={`row kind--${category}${selected ? ' row--selected' : ''}${isErrorEvent(final) ? ' row--error' : ''}`}
      onClick={onClick}
    >
      <span className="row__offset">+{formatDuration(startMs - runStartMs)}</span>
      <span className={`row__kind kind--${category}`} aria-hidden="true" />
      <span className="row__text">
        <span className="row__label">{label}</span>
        {summary && <span className="row__summary">{summary}</span>}
      </span>
      <span className="row__badges">
        {item.events.length > 1 && <span className="badge badge--retry">{item.events.length} attempts</span>}
        {approval && first.event.type === 'approval.request' && (
          <span className={`badge badge--${approval.outcome}`}>{approval.outcome}</span>
        )}
        {failed && (isErrorEvent(final) ? <span className="badge badge--error">error</span> : <span className="badge badge--recovered">recovered</span>)}
      </span>
      <span className="row__duration">{span > 0 ? formatDuration(span) : ''}</span>
      <span className="row__bar" aria-hidden="true">
        <span className="row__bar-fill" style={{ left: `${left}%`, width: `${width}%` }} />
      </span>
    </div>
  )
}
