import { useMemo, useReducer, useState } from 'react'
import { FilePicker } from './import/FilePicker.tsx'
import { IssuesPanel } from './import/IssuesPanel.tsx'
import { SampleMenu } from './import/SampleMenu.tsx'
import { RunHeader } from './run/RunHeader.tsx'
import { TotalsBar } from './run/TotalsBar.tsx'
import { FilterBar, SEARCH_INPUT_ID } from './run/FilterBar.tsx'
import { Timeline } from './timeline/Timeline.tsx'
import { groupItems } from './timeline/groups.ts'
import { ShortcutHelp } from './a11y/ShortcutHelp.tsx'
import { DetailPanel } from './detail/DetailPanel.tsx'
import { ComparePicker } from './compare/ComparePicker.tsx'
import { CompareView } from './compare/CompareView.tsx'
import { useGlobalKeys } from './a11y/useGlobalKeys.ts'
import { initialState, reducer } from './state.ts'

const TIMELINE_SELECTOR = '.timeline'

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [helpOpen, setHelpOpen] = useState(false)
  const load = (name: string, text: string) => dispatch({ type: 'loaded', name, text })
  const onError = (message: string) => dispatch({ type: 'loadFailed', message })

  const run = state.file?.runs[state.runIndex]
  const groups = useMemo(() => (run ? groupItems(run.items, state.filters) : []), [run, state.filters])
  const shown = groups.reduce((n, g) => n + g.items.length, 0)
  const detailItem = state.detailOpen ? run?.items.find((i) => i.id === state.selectedId) : undefined

  const keys = useMemo(
    () => ({
      '?': () => setHelpOpen((open) => !open),
      '/': () => document.getElementById(SEARCH_INPUT_ID)?.focus(),
      t: () => document.querySelector<HTMLElement>(TIMELINE_SELECTOR)?.focus(),
      e: () => dispatch({ type: 'setErrorsOnly', value: !state.filters.errorsOnly }),
      Escape: () => {
        if (helpOpen) setHelpOpen(false)
        else if (state.comparing) dispatch({ type: 'stopCompare' })
        else if (state.detailOpen) dispatch({ type: 'closeDetail' })
        else if (document.activeElement?.id === SEARCH_INPUT_ID) document.querySelector<HTMLElement>(TIMELINE_SELECTOR)?.focus()
      },
    }),
    [helpOpen, state.comparing, state.detailOpen, state.filters.errorsOnly],
  )
  useGlobalKeys(keys, state.file !== undefined)

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

  const { file, runIndex, compare } = state
  const compareRun = compare?.runs[compare.runIndex]
  return (
    <main className="viewer">
      <RunHeader
        fileName={file.name}
        format={file.format}
        runs={file.runs}
        runIndex={runIndex}
        onSelectRun={(index) => dispatch({ type: 'selectRun', index })}
        onClose={() => dispatch({ type: 'close' })}
        onHelp={() => setHelpOpen(true)}
        onCompare={state.comparing ? undefined : () => dispatch({ type: 'startCompare' })}
      />
      <IssuesPanel issues={file.issues} />
      {run && state.comparing ? (
        compare && compareRun ? (
          <CompareView
            a={{ run, fileName: file.name }}
            b={{ run: compareRun, fileName: compare.name }}
            bRuns={compare.runs}
            bIndex={compare.runIndex}
            onSelectB={(index) => dispatch({ type: 'selectCompareRun', index })}
            onChange={() => dispatch({ type: 'changeCompare' })}
            onDone={() => dispatch({ type: 'stopCompare' })}
          />
        ) : (
          <ComparePicker
            runs={file.runs}
            runIndex={runIndex}
            error={state.loadError}
            onPickRun={(index) => dispatch({ type: 'compareWithRun', index })}
            onText={(name, text) => dispatch({ type: 'compareLoaded', name, text })}
            onError={onError}
            onCancel={() => dispatch({ type: 'stopCompare' })}
          />
        )
      ) : run ? (
        <>
          <TotalsBar totals={run.totals} />
          <FilterBar
            run={run}
            filters={state.filters}
            shown={shown}
            onToggle={(category) => dispatch({ type: 'toggleCategory', category })}
            onErrorsOnly={(value) => dispatch({ type: 'setErrorsOnly', value })}
            onText={(text) => dispatch({ type: 'setText', text })}
            onClear={() => dispatch({ type: 'clearFilters' })}
          />
          <div className={`workspace${detailItem ? ' workspace--split' : ''}`}>
          <Timeline
            run={run}
            groups={groups}
            collapsed={state.collapsed}
            selectedId={state.selectedId}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onOpen={(id) => dispatch({ type: 'openDetail', id })}
            onCollapse={(key, collapsed) => dispatch({ type: 'setCollapsed', key, collapsed })}
          />
          {detailItem && <DetailPanel run={run} item={detailItem} onClose={() => dispatch({ type: 'closeDetail' })} />}
          </div>
        </>
      ) : (
        <p className="muted">No readable events in this file.</p>
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </main>
  )
}
