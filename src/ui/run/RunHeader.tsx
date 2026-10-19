import type { Run } from '../../core/model/run.ts'
import { formatDuration } from '../format.ts'

interface Props {
  fileName: string
  runs: Run[]
  runIndex: number
  onSelectRun: (index: number) => void
  onClose: () => void
}

export function RunHeader({ fileName, runs, runIndex, onSelectRun, onClose }: Props) {
  const run = runs[runIndex]
  return (
    <header className="run-header">
      <div className="run-header__title">
        <h1>{run?.agent ? `${run.agent.name}${run.agent.version ? ` ${run.agent.version}` : ''}` : (run?.id ?? fileName)}</h1>
        {run && <span className={`status status--${run.status}`}>{run.status}</span>}
      </div>
      <div className="run-header__meta">
        <span className="muted">{fileName}</span>
        {run && run.events.length > 0 && (
          <span className="muted">
            {new Date(run.startMs).toLocaleString()} · {formatDuration(run.totals.wallMs)}
          </span>
        )}
        {runs.length > 1 && (
          <label>
            Run{' '}
            <select value={runIndex} onChange={(e) => onSelectRun(Number(e.target.value))}>
              {runs.map((r, i) => (
                <option key={r.id} value={i}>
                  {r.id} ({r.status})
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="button" onClick={onClose}>
          Close file
        </button>
      </div>
    </header>
  )
}
