import { useMemo } from 'react'
import type { Run } from '../../core/model/run.ts'
import { costByAgent, costByModel, type AgentCostRow, type CostRow } from '../../core/derive/breakdown.ts'
import { formatTokens, formatUsd } from '../format.ts'

export const BREAKDOWN_ID = 'cost-breakdown'

interface Props {
  run: Run
  open: boolean
  onToggle: (open: boolean) => void
  // Opens a sub-agent's agent.call event in the timeline.
  onJump?: (eventId: string) => void
}

// Where the run's tokens and cost went: by model, and by agent when the run
// handed work to sub-agents. Folded away until asked for.
export function CostBreakdown({ run, open, onToggle, onJump }: Props) {
  const models = useMemo(() => costByModel(run.items, run.pricing), [run])
  const agents = useMemo(() => costByAgent(run.items, run.pricing, run.agent?.name), [run])
  if (models.length === 0) return null
  const total = run.totals.costUsd

  return (
    <details id={BREAKDOWN_ID} className="breakdown" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        Cost breakdown <span className="muted">by model{agents.length ? ' and sub-agent' : ''}</span>
      </summary>
      <div className="breakdown__tables">
        <table className="breakdown__table">
          <caption>By model</caption>
          <Head first="Model" />
          <tbody>
            {models.map((row) => (
              <Row key={row.key} row={row} total={total} />
            ))}
          </tbody>
        </table>
        {agents.length > 0 && (
          <table className="breakdown__table">
            <caption>By agent</caption>
            <Head first="Agent" withTotal />
            <tbody>
              {agents.map((row) => (
                <Row key={row.key} row={row} total={total} agent={row} onJump={onJump} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted breakdown__note">
        Every attempt of a retried call counts. An agent's own cost leaves out the sub-agents it called; the last column adds them back.
      </p>
    </details>
  )
}

function Head({ first, withTotal }: { first: string; withTotal?: boolean }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col">Calls</th>
        <th scope="col">Tokens in / out</th>
        <th scope="col">{withTotal ? 'Own cost' : 'Cost'}</th>
        <th scope="col">Share</th>
        {withTotal && <th scope="col">With sub-agents</th>}
      </tr>
    </thead>
  )
}

function Row({ row, total, agent, onJump }: { row: CostRow; total: number; agent?: AgentCostRow; onJump?: (eventId: string) => void }) {
  const share = total > 0 ? row.costUsd / total : 0
  return (
    <tr>
      <th scope="row" className="breakdown__label" style={agent?.depth ? { paddingLeft: `${0.5 + agent.depth * 1.1}rem` } : undefined}>
        {agent?.depth ? <span aria-hidden="true">↳ </span> : null}
        {agent?.eventId && onJump ? (
          <button type="button" className="button button--link" onClick={() => onJump(agent.eventId!)} title="Show this sub-agent in the timeline">
            {row.label} <span className="muted mono">{agent.eventId}</span>
          </button>
        ) : (
          <>
            <span className={agent ? undefined : 'mono'}>{row.label}</span>
            {agent?.eventId && <span className="muted mono"> {agent.eventId}</span>}
          </>
        )}
      </th>
      <td>{row.modelCalls}</td>
      <td>
        {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
      </td>
      <td title={row.unpriced ? `${row.unpriced} call(s) have no logged cost and no known price` : undefined}>
        {formatUsd(row.costUsd)}
        {row.estimated && ' est.'}
        {row.unpriced > 0 && <span className="totals__note"> *</span>}
      </td>
      <td>
        <span className="breakdown__share">
          <span className="breakdown__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          {Math.round(share * 100)}%
        </span>
      </td>
      {agent && (
        <td>
          {formatUsd(agent.totalUsd)}
          {agent.totalEstimated && ' est.'}
        </td>
      )}
    </tr>
  )
}
