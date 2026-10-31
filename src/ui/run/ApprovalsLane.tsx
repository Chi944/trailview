import { useRef, useState, type KeyboardEvent } from 'react'
import type { Run } from '../../core/model/run.ts'
import { AUDIT_FLAG_LABELS, decidedBy, type AuditEntry } from '../../core/derive/audit.ts'
import { formatDuration } from '../format.ts'

export const LANE_ID = 'approvals-lane'

interface Props {
  run: Run
  entries: AuditEntry[]
  selectedId?: string
  onJump: (eventId: string) => void
}

// Narrow enough to still show, and to click, on a long run.
const MIN_WIDTH_PCT = 0.8

// Each approval as a bar on the run's clock, from request to decision. One
// bar is in the tab order at a time; the arrow keys move between them.
export function ApprovalsLane({ run, entries, selectedId, onJump }: Props) {
  const [active, setActive] = useState(0)
  const bars = useRef<(HTMLButtonElement | null)[]>([])
  if (entries.length === 0) return null

  const wallMs = Math.max(1, run.endMs - run.startMs)
  const selected = entries.findIndex((e) => e.eventId === selectedId)
  const current = Math.min(selected >= 0 ? selected : active, entries.length - 1)

  function focus(index: number) {
    const next = Math.max(0, Math.min(entries.length - 1, index))
    setActive(next)
    bars.current[next]?.focus()
  }

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowDown: current + 1, ArrowLeft: current - 1, ArrowUp: current - 1, Home: 0, End: entries.length - 1 }
    const target = moves[e.key]
    if (target === undefined) return
    e.preventDefault()
    focus(target)
  }

  return (
    <div className="lane" role="group" aria-label={`Approvals: ${entries.length}`}>
      <span className="lane__label" aria-hidden="true">
        Approvals
      </span>
      <div id={LANE_ID} className="lane__track" onKeyDown={onKeyDown}>
        {entries.map((entry, i) => {
          const left = ((entry.startMs - run.startMs) / wallMs) * 100
          const width = Math.max(MIN_WIDTH_PCT, ((entry.endMs - entry.startMs) / wallMs) * 100)
          const { approval } = entry
          const action = approval.request?.action ?? approval.toolCall?.tool ?? approval.approvalId
          const waited = approval.waitMs !== undefined ? `, waited ${formatDuration(approval.waitMs)}` : ''
          const flags = entry.flags.length ? `. ${entry.flags.map((f) => AUDIT_FLAG_LABELS[f]).join('. ')}` : ''
          const label = `${action}: ${decidedBy(approval)}${waited}${flags}`
          return (
            <button
              key={approval.approvalId}
              ref={(el) => {
                bars.current[i] = el
              }}
              type="button"
              className={`lane__bar lane__bar--${approval.outcome}${entry.flags.length ? ' lane__bar--flagged' : ''}${i === selected ? ' lane__bar--selected' : ''}`}
              style={{ left: `${Math.min(left, 100 - MIN_WIDTH_PCT)}%`, width: `${Math.min(width, 100 - Math.min(left, 100 - MIN_WIDTH_PCT))}%` }}
              tabIndex={i === current ? 0 : -1}
              aria-label={label}
              title={label}
              onFocus={() => setActive(i)}
              onClick={() => onJump(entry.eventId)}
            />
          )
        })}
      </div>
    </div>
  )
}
