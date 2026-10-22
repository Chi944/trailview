import type { CSSProperties } from 'react'
import type { TimelineItem } from '../../core/derive/retries.ts'
import { categoryOf, isErrorEvent, itemHasError } from '../../core/filter.ts'
import type { Approval } from '../../core/derive/approvals.ts'
import { isUnfinished } from '../../core/derive/starts.ts'
import { formatDuration } from '../format.ts'
import { describeEvent } from './describe.ts'
import { itemSpan } from './groups.ts'
import type { SearchHit } from '../../core/search.ts'

export interface RowProps {
  item: TimelineItem
  runStartMs: number
  runWallMs: number
  selected: boolean
  approval?: Approval
  onClick: () => void
  // Set when the timeline renders only the rows in view: the row then says
  // which step it is in and where it sits, since its group is not in the DOM.
  stepLabel?: string
  position?: number
  setSize?: number
  style?: CSSProperties
  // Set on a row with events nested under it (a sub-agent's work).
  folded?: boolean
  onToggleFold?: () => void
  // Where the search matched, shown in place of the summary.
  hit?: SearchHit
}

export function rowDomId(id: string): string {
  return `row-${id}`
}

export function TimelineRow({ item, runStartMs, runWallMs, selected, approval, onClick, stepLabel, position, setSize, style, folded, onToggleFold, hit }: RowProps) {
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
      aria-posinset={position}
      aria-setsize={setSize}
      className={`row kind--${category}${selected ? ' row--selected' : ''}${isErrorEvent(final) ? ' row--error' : ''}`}
      style={style}
      onClick={onClick}
    >
      {stepLabel && <span className="visually-hidden">{stepLabel}: </span>}
      <span className="row__offset">+{formatDuration(startMs - runStartMs)}</span>
      <span className={`row__kind kind--${category}`} aria-hidden="true" />
      <span className="row__text" style={item.depth ? ({ '--depth': item.depth } as CSSProperties) : undefined}>
        {item.depth ? <span className="row__nest" aria-hidden="true" /> : null}
        <span className="row__label">{label}</span>
        {hit ? (
          <span className="row__summary row__hit">
            <span className="row__hit-path">{hit.path}:</span> {hit.before}
            {hit.match && <mark>{hit.match}</mark>}
            {hit.after}
          </span>
        ) : (
          summary && <span className="row__summary">{summary}</span>
        )}
      </span>
      <span className="row__badges">
        {onToggleFold && (
          // Mouse shortcut for ←/→; the state is in the text so screen readers hear it too.
          <span
            className="badge badge--nested"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFold()
            }}
          >
            {folded ? '▸' : '▾'} {item.descendants} nested{folded ? ', hidden' : ''}
          </span>
        )}
        {item.events.length > 1 && <span className="badge badge--retry">{item.events.length} attempts</span>}
        {approval && first.event.type === 'approval.request' && (
          <span className={`badge badge--${approval.outcome}`}>{approval.outcome}</span>
        )}
        {failed &&
          (isUnfinished(final) ? (
            <span className="badge badge--error">unfinished</span>
          ) : isErrorEvent(final) ? (
            <span className="badge badge--error">error</span>
          ) : (
            <span className="badge badge--recovered">recovered</span>
          ))}
      </span>
      <span className="row__duration">{span > 0 ? formatDuration(span) : ''}</span>
      <span className="row__bar" aria-hidden="true">
        <span className="row__bar-fill" style={{ left: `${left}%`, width: `${width}%` }} />
      </span>
    </div>
  )
}
