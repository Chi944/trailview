import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { Run } from '../../core/model/run.ts'
import { formatDuration, formatTokens } from '../format.ts'
import type { TimelineItem } from '../../core/derive/retries.ts'
import { foldKey, groupKeyOf, moveSelection, type StepGroup } from './groups.ts'
import { TimelineRow, rowDomId, type RowProps } from './TimelineRow.tsx'
import { layoutEntries, scrollToReveal, visibleRange } from './window.ts'

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
// Above this many visible rows only the rows in view are rendered.
export const VIRTUAL_THRESHOLD = 400
// Starting guesses; the real heights are measured from the first rendered header and row.
const DEFAULT_HEADER_PX = 30
const DEFAULT_ROW_PX = 36

export function Timeline({ run, groups, collapsed, selectedId, onSelect, onOpen, onCollapse }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const approvalByRequestId = new Map(run.approvals.filter((a) => a.request).map((a) => [a.request!.id, a]))
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0)
  const virtual = visibleCount > VIRTUAL_THRESHOLD

  useEffect(() => {
    if (!virtual && selectedId) document.getElementById(rowDomId(selectedId))?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, virtual])

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
        // On a row with a sub-agent under it, ←/→ fold that row; elsewhere they collapse the step.
        const selected = selectedId ? findItem(groups, selectedId) : undefined
        const key = selected?.descendants ? foldKey(selected.id) : selectedId && groupKeyOf(groups, selectedId)
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

  const renderRow = (item: TimelineItem, extra: Pick<RowProps, 'stepLabel' | 'position' | 'setSize' | 'style'> = {}) => {
    const folded = collapsed.includes(foldKey(item.id))
    return (
      <TimelineRow
        key={item.id}
        item={item}
        runStartMs={run.startMs}
        runWallMs={run.totals.wallMs}
        selected={item.id === selectedId}
        approval={approvalByRequestId.get(item.id)}
        folded={folded}
        onToggleFold={item.descendants ? () => onCollapse(foldKey(item.id), !folded) : undefined}
        onClick={() => {
          list.current?.focus()
          onOpen(item.id)
        }}
        {...extra}
      />
    )
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
      {virtual ? (
        <VirtualRows
          list={list}
          groups={groups}
          collapsed={collapsed}
          selectedId={selectedId}
          header={(group, style) => <GroupHeader key={group.key} group={group} collapsed={collapsed} onCollapse={onCollapse} style={style} />}
          row={(item, group, position, style) =>
            renderRow(item, { stepLabel: group.step !== undefined ? `Step ${group.step}` : 'Run', position, setSize: visibleCount, style })
          }
        />
      ) : (
        groups.map((group) => {
          if (group.items.length === 0) return null
          const isCollapsed = collapsed.includes(group.key)
          const headingId = `group-${group.key}`
          return (
            <div key={group.key} role="group" aria-labelledby={headingId} aria-describedby={`${headingId}-meta`} className="step">
              <GroupHeader group={group} collapsed={collapsed} onCollapse={onCollapse} />
              {!isCollapsed && group.items.map((item) => renderRow(item))}
            </div>
          )
        })
      )}
    </div>
  )
}

function findItem(groups: StepGroup[], id: string): TimelineItem | undefined {
  for (const group of groups) {
    const item = group.items.find((i) => i.id === id)
    if (item) return item
  }
  return undefined
}

interface HeaderProps {
  group: StepGroup
  collapsed: string[]
  onCollapse: (key: string, collapsed: boolean) => void
  style?: CSSProperties
}

function GroupHeader({ group, collapsed, onCollapse, style }: HeaderProps) {
  const isCollapsed = collapsed.includes(group.key)
  const headingId = `group-${group.key}`
  // A listbox may only own groups and options, so the header is mouse-only; keyboard users collapse with ←/→.
  return (
    <div className="step__header" aria-hidden="true" style={style}>
      <div className="step__toggle" onClick={() => onCollapse(group.key, !isCollapsed)}>
        <span>{isCollapsed ? '▸' : '▾'}</span>
        <span id={headingId} className="step__title">
          {group.step !== undefined ? `Step ${group.step}` : 'Run'}
        </span>
      </div>
      <span id={`${headingId}-meta`} className="step__meta muted">
        {isCollapsed && 'Collapsed · '}
        {group.items.length + group.folded < group.total ? `${group.items.length} of ${group.total} events` : `${group.total} event${group.total === 1 ? '' : 's'}`}
        {group.endMs > group.startMs && ` · ${formatDuration(group.endMs - group.startMs)}`}
        {group.inputTokens + group.outputTokens > 0 && ` · ${formatTokens(group.inputTokens)} in / ${formatTokens(group.outputTokens)} out`}
        {group.errors > 0 && <span className="step__errors"> · {group.errors} error{group.errors === 1 ? '' : 's'}</span>}
      </span>
    </div>
  )
}

interface VirtualProps {
  list: RefObject<HTMLDivElement | null>
  groups: StepGroup[]
  collapsed: string[]
  selectedId?: string
  header: (group: StepGroup, style: CSSProperties) => ReactNode
  row: (item: TimelineItem, group: StepGroup, position: number, style: CSSProperties) => ReactNode
}

// Renders only the headers and rows in view (and the selected row, so
// aria-activedescendant always points at an element). Heights are fixed by CSS
// and measured once from the DOM.
function VirtualRows({ list, groups, collapsed, selectedId, header, row }: VirtualProps) {
  const [heights, setHeights] = useState({ header: DEFAULT_HEADER_PX, row: DEFAULT_ROW_PX })
  const [viewport, setViewport] = useState({ top: 0, height: 600 })
  const inner = useRef<HTMLDivElement>(null)
  const layout = useMemo(() => layoutEntries(groups, collapsed, heights.header, heights.row), [groups, collapsed, heights])
  const positions = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const entry of layout.entries) if (entry.kind === 'row') map.set(entry.item.id, ++n)
    return map
  }, [layout])

  useEffect(() => {
    const el = list.current
    if (!el) return
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [list])

  useLayoutEffect(() => {
    const headerEl = inner.current?.querySelector<HTMLElement>('.step__header')
    const rowEl = inner.current?.querySelector<HTMLElement>('.row')
    const measured = { header: headerEl?.offsetHeight || heights.header, row: rowEl?.offsetHeight || heights.row }
    if (measured.header !== heights.header || measured.row !== heights.row) setHeights(measured)
  }, [heights.header, heights.row, layout])

  useEffect(() => {
    const el = list.current
    const index = selectedId === undefined ? undefined : layout.indexById.get(selectedId)
    if (!el || index === undefined) return
    const next = scrollToReveal(layout.tops[index]!, layout.tops[index + 1]!, el.scrollTop, el.clientHeight)
    if (next !== undefined) el.scrollTo({ top: next })
  }, [selectedId, layout, list])

  const { start, end } = visibleRange(layout.tops, viewport.top, viewport.height)
  const indices = Array.from({ length: end - start }, (_, i) => start + i)
  const selectedIndex = selectedId === undefined ? undefined : layout.indexById.get(selectedId)
  if (selectedIndex !== undefined && (selectedIndex < start || selectedIndex >= end)) indices.push(selectedIndex)

  return (
    <div ref={inner} className="timeline__space" style={{ height: layout.tops.at(-1) }}>
      {indices.map((i) => {
        const entry = layout.entries[i]!
        const style: CSSProperties = { position: 'absolute', top: layout.tops[i], left: 0, right: 0 }
        return entry.kind === 'header' ? header(entry.group, style) : row(entry.item, entry.group, positions.get(entry.item.id)!, style)
      })}
    </div>
  )
}
