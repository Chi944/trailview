import { useReducer } from 'react'
import { FilePicker } from './import/FilePicker.tsx'
import { IssuesPanel } from './import/IssuesPanel.tsx'
import { SampleMenu } from './import/SampleMenu.tsx'
import { RunHeader } from './run/RunHeader.tsx'
import { TotalsBar } from './run/TotalsBar.tsx'
import { initialState, reducer } from './state.ts'

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const load = (name: string, text: string) => dispatch({ type: 'loaded', name, text })
  const onError = (message: string) => dispatch({ type: 'loadFailed', message })

  if (!state.file) {
    return (
      <main className="empty">
        <h1>Trailview</h1>
        <p className="lede">See an agent run as a timeline. Your log is read in this tab and never leaves your machine.</p>
        <FilePicker onText={load} onError={onError} />
        {state.loadError && (
          <p role="alert" className="error-text">
            {state.loadError}
          </p>
        )}
        <SampleMenu onPick={load} />
      </main>
    )
  }

  const { file, runIndex } = state
  const run = file.runs[runIndex]
  return (
    <main className="viewer">
      <RunHeader
        fileName={file.name}
        runs={file.runs}
        runIndex={runIndex}
        onSelectRun={(index) => dispatch({ type: 'selectRun', index })}
        onClose={() => dispatch({ type: 'close' })}
      />
      <IssuesPanel issues={file.issues} />
      {run ? <TotalsBar totals={run.totals} /> : <p className="muted">No readable events in this file.</p>}
    </main>
  )
}
