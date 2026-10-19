import type { ApprovalDecisionEvent, ApprovalRequestEvent, ToolCallEvent } from '../schema/events.ts'
import type { ParsedEvent } from '../parse/jsonl.ts'

export interface Approval {
  approvalId: string
  request?: ApprovalRequestEvent
  decision?: ApprovalDecisionEvent
  // The tool call that ran because of this approval, if any.
  toolCall?: ToolCallEvent
  outcome: 'approved' | 'rejected' | 'pending'
  // Time from request to decision; undefined until both exist.
  waitMs?: number
}

export function pairApprovals(events: ParsedEvent[]): Approval[] {
  const byId = new Map<string, Approval>()
  const get = (approvalId: string) => {
    let approval = byId.get(approvalId)
    if (!approval) {
      approval = { approvalId, outcome: 'pending' }
      byId.set(approvalId, approval)
    }
    return approval
  }

  for (const parsed of events) {
    if (parsed.kind !== 'known') continue
    const event = parsed.event
    if (event.type === 'approval.request') get(event.approval_id).request ??= event
    else if (event.type === 'approval.decision') get(event.approval_id).decision ??= event
    else if (event.type === 'tool.call' && event.approval_id) get(event.approval_id).toolCall ??= event
  }

  for (const approval of byId.values()) {
    if (approval.decision) approval.outcome = approval.decision.decision
    if (approval.request && approval.decision) {
      approval.waitMs = Math.max(0, Date.parse(approval.decision.ts) - Date.parse(approval.request.ts))
    }
  }
  return [...byId.values()]
}
