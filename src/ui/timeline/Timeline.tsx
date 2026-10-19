import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { Run } from '../../core/model/run.ts'
import { formatDuration, formatTokens } from '../format.ts'
import { groupKeyOf, moveSelection, type StepGroup } from './groups.ts'
import { TimelineRow, rowDomId } from './TimelineRow.tsx'

interface Props {
  run: Run
  groups: StepGroup[]
  collapsed: string[]
  selectedId?: string
  onSelect: (id: string | undefined) => void
  onOpen: (id: string) => void
  onCollapse: (key: string, collapsed: boolean) => void
}

const PAGE = 10

export function Timeline({ run, groups, collapsed, selectedId, onSelect, onOpen, onCollapse }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const approvalByRequestId = new Map(run.approvals.filter((a) => a.request).map((a) => [a.request!.id, a]))
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0)

  useEffect(() => {
    if (selectedId) document.getElementById(rowDomId(selectedId))?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  function onKeyDown(e: KeyboardEvent) {
    const move = (delta: number) => {
      e.preventDefault()
      onSelect(moveSelection(groups, collapsed, selectedId, delta))
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        return move(1)
      case 'ArrowUp':
      case 'k':
        return move(-1)
      case 'PageDown':
        return move(PAGE)
      case 'PageUp':
        return move(-PAGE)
      case 'Home':
        return move(-Infinity)
      case 'End':
        return move(Infinity)
      case 'Enter':
      case ' ':
        if (selectedId) {
          e.preventDefault()
          onOpen(selectedId)
        }
        return
      case 'ArrowLeft':
      case 'ArrowRight': {
        const key = selectedId && groupKeyOf(groups, selectedId)
        if (key) {
          e.preventDefault()
          onCollapse(key, e.key === 'ArrowLeft')
        }
        return
      }
    }
  }

  if (visibleCount === 0) {
    return <p className="muted timeline-empty">No events match the current filters.</p>
  }

  return (
    <div
      ref={list}
      className="timeline"
      role="listbox"
      tabIndex={0}
      aria-label="Run timeline"
      aria-activedescendant={selectedId ? rowDomId(selectedId) : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (!selectedId) onSelect(moveSelection(groups, collapsed, undefined, 1))
      }}
    >
      {groups.map((group) => {
        if (group.items.length === 0) return null
        const isCollapsed = collapsed.includes(group.key)
        const headingId = `group-${group.key}`
        return (
          <div key={group.key} role="group" aria-labelledby={headingId} aria-describedby={`${headingId}-meta`} className="step">
            {/* A listbox may only own groups and options, so the header is mouse-only; keyboard users collapse with ←/→. */}
            <div className="step__header" aria-hidden="true">
              <div className="step__toggle" onClick={() => onCollapse(group.key, !isCollapsed)}>
                <span>{isCollapsed ? '▸' : '▾'}</span>
                <span id={headingId} className="step__title">
                  {group.step !== undefined ? `Step ${group.step}` : 'Run'}
                </span>
              </div>
              <span id={`${headingId}-meta`} className="step__meta muted">
                {isCollapsed && 'Collapsed · '}
                {group.items.length < group.total ? `${group.items.length} of ${group.total} events` : `${group.total} event${group.total === 1 ? '' : 's'}`}
                {group.endMs > group.startMs && ` · ${formatDuration(group.endMs - group.startMs)}`}
                {group.inputTokens + group.outputTokens > 0 &&
                  ` · ${formatTokens(group.inputTokens)} in / ${formatTokens(group.outputTokens)} out`}
                {group.errors > 0 && <span className="step__errors"> · {group.errors} error{group.errors === 1 ? '' : 's'}</span>}
              </span>
            </div>
            {!isCollapsed &&
              group.items.map((item) => (
                <TimelineRow
                  key={item.id}
                  item={item}
                  runStartMs={run.startMs}
                  runWallMs={run.totals.wallMs}
                  selected={item.id === selectedId}
                  approval={approvalByRequestId.get(item.id)}
                  onClick={() => {
                    list.current?.focus()
                    onOpen(item.id)
                  }}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
