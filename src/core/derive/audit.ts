import type { Approval } from './approvals.ts'

// Something in an approval's record that a reviewer should look at.
//  ran-after-rejection: a tool call carries the approval's id although the answer was no.
//  no-request: a decision or tool call names an approval that was never requested.
//  unanswered: the request has no decision in the log.
export type AuditFlag = 'ran-after-rejection' | 'no-request' | 'unanswered'

export const AUDIT_FLAG_LABELS: Record<AuditFlag, string> = {
  'ran-after-rejection': 'Tool ran after rejection',
  'no-request': 'No request logged',
  unanswered: 'Never answered',
}

export interface AuditEntry {
  approval: Approval
  // The event to show for this approval: its request, else its decision, else the tool call.
  eventId: string
  step?: number
  // When the approval starts and ends on the run's clock. A pending approval
  // runs to the end of the run.
  startMs: number
  endMs: number
  flags: AuditFlag[]
}

// Every approval in a run, in the order it started, with what a reviewer
// needs to check it.
export function auditTrail(approvals: Approval[], runEndMs: number): AuditEntry[] {
  const entries: AuditEntry[] = []
  for (const approval of approvals) {
    const { request, decision, toolCall } = approval
    const first = request ?? decision ?? toolCall
    if (!first) continue
    const startMs = Date.parse(first.ts)
    const endMs = decision ? Math.max(startMs, Date.parse(decision.ts)) : Math.max(startMs, runEndMs)
    const flags: AuditFlag[] = []
    if (approval.outcome === 'rejected' && toolCall) flags.push('ran-after-rejection')
    if (!request) flags.push('no-request')
    else if (!decision) flags.push('unanswered')
    entries.push({ approval, eventId: first.id, step: first.step, startMs, endMs, flags })
  }
  return entries.sort((a, b) => a.startMs - b.startMs)
}

// "rejected by d (human)", "approved by policy", "pending"
export function decidedBy(approval: Approval): string {
  const by = approval.decision?.by
  if (!by) return approval.outcome
  if (by.kind === 'policy') return `${approval.outcome} by policy${by.name ? ` ${by.name}` : ''}`
  return `${approval.outcome} by ${by.name ?? 'a person'}`
}
