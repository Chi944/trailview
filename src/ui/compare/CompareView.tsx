import { useMemo } from 'react'
import type { Run } from '../../core/model/run.ts'
import { compareRuns, type StepPair, type StepSummary, type TotalsRow } from '../../core/compare/compare.ts'
import { formatDuration, formatTokens, formatUsd } from '../format.ts'
import { runLabel } from './labels.ts'

interface Side {
  run: Run
  fileName: string
}

interface Props {
  a: Side
  b: Side
  // Other runs in B's file, to switch between them.
  bRuns: Run[]
  bIndex: number
  onSelectB: (index: number) => void
  onChange: () => void
  onDone: () => void
}

export function CompareView({ a, b, bRuns, bIndex, onSelectB, onChange, onDone }: Props) {
  const result = useMemo(() => compareRuns(a.run, b.run), [a.run, b.run])
  return (
    <section className="compare" aria-labelledby="compare-heading">
      <div className="compare__head">
        <h2 id="compare-heading">Comparing two runs</h2>
        <div className="compare__actions">
          {bRuns.length > 1 && (
            <label>
              B run{' '}
              <select value={bIndex} onChange={(e) => onSelectB(Number(e.target.value))}>
                {bRuns.map((r, i) => (
                  <option key={r.id} value={i}>
                    {r.id} ({r.status})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="button" onClick={onChange}>
            Pick another run
          </button>
          <button type="button" className="button" onClick={onDone}>
            Back to timeline
          </button>
        </div>
      </div>

      <div className="compare__sides">
        <RunCard label="A" side={a} />
        <RunCard label="B" side={b} />
      </div>

      <p className="compare__summary">
        {describeDivergence(result.divergence)}
      </p>

      <table className="compare-table">
        <caption>Totals</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">Change (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {result.totals.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{formatValue(row, row.a, a.run)}</td>
              <td>{formatValue(row, row.b, b.run)}</td>
              <td className={deltaClass(row)}>{formatDelta(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="compare-table compare-table--steps">
        <caption>Steps</caption>
        <thead>
          <tr>
            <th scope="col">Steps (A / B)</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
          </tr>
        </thead>
        <tbody>
          {result.steps.map((pair, index) => (
            <tr key={index} className={pair.differs ? 'compare-table__differs' : undefined}>
              <th scope="row">
                {pair.a?.step ?? '–'} / {pair.b?.step ?? '–'}
                {pair.differs && <span className="badge badge--warn compare-table__flag">differs</span>}
              </th>
              <td>
                <StepCell step={pair.a} />
              </td>
              <td>
                <StepCell step={pair.b} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function RunCard({ label, side }: { label: string; side: Side }) {
  const { run, fileName } = side
  return (
    <div className="compare__card">
      <span className="compare__label" aria-hidden="true">
        {label}
      </span>
      <div>
        <strong>
          <span className="visually-hidden">{label}: </span>
          {runLabel(run)}
        </strong>{' '}
        <span className={`status status--${run.status}`}>{run.status}</span>
        <div className="muted">
          {fileName} · {run.id}
          {run.events.length > 0 && ` · ${new Date(run.startMs).toLocaleString()}`}
        </div>
      </div>
    </div>
  )
}

function describeDivergence(pair: StepPair | undefined): string {
  if (!pair) return 'Both runs took the same steps, calling the same models and tools, and their approvals ended the same way.'
  if (pair.a && pair.b) return `The runs first differ at A step ${pair.a.step} / B step ${pair.b.step}, where an approval ended differently.`
  if (pair.a) return `The runs first differ at A step ${pair.a.step}, which B has no matching step for.`
  return `The runs first differ at B step ${pair.b!.step}, which A has no matching step for.`
}

function StepCell({ step }: { step: StepSummary | undefined }) {
  if (!step) return <span className="muted">No matching step</span>
  return (
    <div className="step-cell">
      <div>
        {step.models.join(', ') || <span className="muted">no model call</span>}
        {step.tools.length > 0 && <> → {step.tools.join(', ')}</>}
      </div>
      <div className="muted">
        {formatTokens(step.inputTokens)} in / {formatTokens(step.outputTokens)} out · {formatUsd(step.costUsd)} · {formatDuration(step.durationMs)}
        {step.errors > 0 && <span className="error-text"> · {step.errors} error{step.errors > 1 ? 's' : ''}</span>}
      </div>
      {step.approvals.map((approval, i) => (
        <div key={i}>
          Approval for {approval.action}: {approval.decision ?? 'no decision'}
        </div>
      ))}
    </div>
  )
}

function formatValue(row: TotalsRow, value: number, run: Run): string {
  if (row.key === 'wallMs' || row.key === 'waitMs') return formatDuration(value)
  if (row.key === 'costUsd') return `${formatUsd(value)}${run.totals.costEstimated ? ' est.' : ''}`
  return formatTokens(value)
}

function formatDelta(row: TotalsRow): string {
  if (row.delta === 0) return 'same'
  const sign = row.delta > 0 ? '+' : '−'
  const size = Math.abs(row.delta)
  let text: string
  if (row.key === 'wallMs' || row.key === 'waitMs') text = formatDuration(size)
  else if (row.key === 'costUsd') text = formatUsd(size)
  else text = formatTokens(size)
  const pct = row.a !== 0 ? ` (${sign}${Math.round((size / row.a) * 100)}%)` : ''
  return `${sign}${text}${pct}`
}

function deltaClass(row: TotalsRow): string | undefined {
  if (row.delta === 0) return 'muted'
  if (!row.lowerIsBetter) return undefined
  return row.delta > 0 ? 'delta delta--worse' : 'delta delta--better'
}
