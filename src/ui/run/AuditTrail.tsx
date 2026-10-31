import type { Run } from '../../core/model/run.ts'
import { AUDIT_FLAG_LABELS, decidedBy, type AuditEntry } from '../../core/derive/audit.ts'
import { formatDuration } from '../format.ts'

export const AUDIT_ID = 'audit-trail'

interface Props {
  run: Run
  entries: AuditEntry[]
  open: boolean
  onToggle: (open: boolean) => void
  onJump: (eventId: string) => void
}

// Every approval in the run as one table row: what was asked, who answered,
// how long it took and what ran afterwards. Folded away until asked for.
export function AuditTrail({ run, entries, open, onToggle, onJump }: Props) {
  if (entries.length === 0) return null
  const flagged = entries.filter((e) => e.flags.length).length

  return (
    <details id={AUDIT_ID} className="breakdown audit" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        Audit trail{' '}
        <span className="muted">
          {entries.length} approval{entries.length === 1 ? '' : 's'}
        </span>
        {flagged > 0 && <span className="badge badge--warn audit__count">{flagged} to check</span>}
      </summary>
      <div className="breakdown__tables">
        <table className="breakdown__table audit__table">
          <thead>
            <tr>
              <th scope="col">Asked</th>
              <th scope="col">Step</th>
              <th scope="col">Action</th>
              <th scope="col">Policy</th>
              <th scope="col">Decision</th>
              <th scope="col">Reason</th>
              <th scope="col">Waited</th>
              <th scope="col">Then ran</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const { approval } = entry
              const { request, decision, toolCall } = approval
              return (
                <tr key={approval.approvalId}>
                  <td>
                    <button type="button" className="button button--link mono" onClick={() => onJump(entry.eventId)} title="Show this approval in the timeline">
                      +{formatDuration(entry.startMs - run.startMs)}
                    </button>
                  </td>
                  <td>{entry.step ?? ''}</td>
                  <td className="audit__wrap">
                    <span className="mono">{request?.action ?? toolCall?.tool ?? approval.approvalId}</span>
                    {request?.summary && <span className="muted"> {request.summary}</span>}
                  </td>
                  <td>{request?.policy ?? ''}</td>
                  <td>
                    <span className={`badge badge--${approval.outcome}`}>{decidedBy(approval)}</span>
                  </td>
                  <td className="audit__wrap">{decision?.reason ?? ''}</td>
                  <td>{approval.waitMs !== undefined ? formatDuration(approval.waitMs) : ''}</td>
                  <td>{toolCall ? `${toolCall.tool} (${toolCall.status})` : approval.outcome === 'rejected' ? 'Nothing' : ''}</td>
                  <td>
                    {entry.flags.map((f) => (
                      <span key={f} className="badge badge--rejected">
                        {AUDIT_FLAG_LABELS[f]}
                      </span>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
