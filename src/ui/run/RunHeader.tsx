import type { Run } from '../../core/model/run.ts'
import { formatDuration } from '../format.ts'
import { FORMAT_LABELS, type LogFormat } from '../../core/parse/detect.ts'

interface Props {
  fileName: string
  format: LogFormat
  runs: Run[]
  runIndex: number
  onSelectRun: (index: number) => void
  onClose: () => void
  onHelp: () => void
  onCompare?: () => void
}

export function RunHeader({ fileName, format, runs, runIndex, onSelectRun, onClose, onHelp, onCompare }: Props) {
  const run = runs[runIndex]
  return (
    <header className="run-header">
      <div className="run-header__title">
        <h1>{run?.agent ? `${run.agent.name}${run.agent.version ? ` ${run.agent.version}` : ''}` : (run?.id ?? fileName)}</h1>
        {run && <span className={`status status--${run.status}`}>{run.status}</span>}
      </div>
      <div className="run-header__meta">
        <span className="muted">
          {fileName}
          {format !== 'jsonl' && ` · ${FORMAT_LABELS[format]}`}
        </span>
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
        {onCompare && run && (
          <button type="button" className="button" onClick={onCompare}>
            Compare
          </button>
        )}
        <button type="button" className="button" onClick={onHelp} aria-label="Keyboard shortcuts">
          ?
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close file
        </button>
      </div>
    </header>
  )
}
