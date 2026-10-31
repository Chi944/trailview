import type { Run } from '../../core/model/run.ts'
import { FilePicker } from '../import/FilePicker.tsx'
import { SampleMenu } from '../import/SampleMenu.tsx'
import { LoadingStatus } from '../import/LoadingStatus.tsx'
import type { Loading } from '../state.ts'
import { runLabel } from './labels.ts'

interface Props {
  runs: Run[]
  runIndex: number
  error?: string
  onPickRun: (index: number) => void
  onFile: (file: File) => void
  onSample: (name: string, text: string) => void
  loading?: Loading
  onStopLoading: () => void
  onCancel: () => void
}

// Chooses the run to compare against: another run in this file, another file, or a sample.
export function ComparePicker({ runs, runIndex, error, onPickRun, onFile, onSample, loading, onStopLoading, onCancel }: Props) {
  const others = runs.map((run, index) => ({ run, index })).filter(({ index }) => index !== runIndex)
  return (
    <section className="compare-picker" aria-labelledby="compare-picker-heading">
      <div className="compare-picker__head">
        <h2 id="compare-picker-heading">Compare {runLabel(runs[runIndex])} with another run</h2>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {others.length > 0 && (
        <>
          <h3>Another run in this file</h3>
          <ul>
            {others.map(({ run, index }) => (
              <li key={run.id}>
                <button type="button" className="button button--link" onClick={() => onPickRun(index)}>
                  {run.id} ({run.status})
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <FilePicker onFile={onFile} label="Open another log file" disabled={loading !== undefined} />
      {loading && <LoadingStatus loading={loading} onCancel={onStopLoading} />}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <SampleMenu onPick={onSample} />
    </section>
  )
}
