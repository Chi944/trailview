import { describe, expect, it } from 'vitest'
import { at, ev, runsFrom } from '../../test/helpers.ts'
import { auditTrail, decidedBy } from './audit.ts'

const request = (id: string, s: number, approvalId: string, step = 1) =>
  ev({ type: 'approval.request', id, ts: at(s), step, approval_id: approvalId, action: 'send_email', summary: 'Send it' })
const decision = (id: string, s: number, approvalId: string, answer: 'approved' | 'rejected', by: Record<string, unknown> = { kind: 'human', name: 'd' }) =>
  ev({ type: 'approval.decision', id, ts: at(s), step: 1, approval_id: approvalId, decision: answer, by })
const tool = (id: string, s: number, approvalId: string) =>
  ev({ type: 'tool.call', id, ts: at(s), step: 1, tool: 'send_email', duration_ms: 5, status: 'ok', approval_id: approvalId })
const end = (s: number) => ev({ type: 'log', id: 'end', ts: at(s), level: 'info', message: 'done' })

function trail(lines: string[]) {
  const [run] = runsFrom(lines)
  return auditTrail(run!.approvals, run!.endMs)
}

describe('auditTrail', () => {
  it('lists approvals in the order they started, spanning request to decision', () => {
    const entries = trail([request('r2', 10, 'b', 2), decision('d2', 12, 'b', 'approved'), request('r1', 1, 'a'), decision('d1', 4, 'a', 'approved'), tool('t1', 5, 'a')])
    expect(entries.map((e) => [e.approval.approvalId, e.eventId, e.step, e.endMs - e.startMs, e.flags])).toEqual([
      ['a', 'r1', 1, 3000, []],
      ['b', 'r2', 2, 2000, []],
    ])
  })

  it('flags a tool that ran although the approval was rejected', () => {
    const [entry] = trail([request('r1', 1, 'a'), decision('d1', 2, 'a', 'rejected'), tool('t1', 3, 'a')])
    expect(entry!.flags).toEqual(['ran-after-rejection'])
  })

  it('flags a request that was never answered and runs it to the end of the run', () => {
    const [entry] = trail([request('r1', 1, 'a'), end(9)])
    expect(entry!.flags).toEqual(['unanswered'])
    expect(entry!.endMs - entry!.startMs).toBe(8000)
  })

  it('flags a decision or tool call with no request, and starts at the first of them', () => {
    const entries = trail([decision('d1', 2, 'a', 'approved'), tool('t1', 3, 'a'), tool('t2', 4, 'orphan')])
    expect(entries.map((e) => [e.approval.approvalId, e.eventId, e.flags])).toEqual([
      ['a', 'd1', ['no-request']],
      ['orphan', 't2', ['no-request']],
    ])
  })

  it('returns nothing for a run without approvals', () => {
    expect(trail([end(1)])).toEqual([])
  })
})

describe('decidedBy', () => {
  it('names the person or the policy that decided', () => {
    const [person] = trail([request('r1', 1, 'a'), decision('d1', 2, 'a', 'rejected')])
    const [policy] = trail([request('r1', 1, 'a'), decision('d1', 2, 'a', 'approved', { kind: 'policy', name: 'low_risk' })])
    const [nameless] = trail([request('r1', 1, 'a'), decision('d1', 2, 'a', 'approved', { kind: 'human' })])
    const [pending] = trail([request('r1', 1, 'a')])
    expect([person, policy, nameless, pending].map((e) => decidedBy(e!.approval))).toEqual([
      'rejected by d',
      'approved by policy low_risk',
      'approved by a person',
      'pending',
    ])
  })
})
