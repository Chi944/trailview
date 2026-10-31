import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { FilePicker } from './import/FilePicker.tsx'
import { IssuesPanel } from './import/IssuesPanel.tsx'
import { SampleMenu } from './import/SampleMenu.tsx'
import { SAMPLES } from './import/samples.ts'
import { RunHeader } from './run/RunHeader.tsx'
import { TotalsBar } from './run/TotalsBar.tsx'
import { CostBreakdown } from './run/CostBreakdown.tsx'
import { ApprovalsLane, LANE_ID } from './run/ApprovalsLane.tsx'
import { AuditTrail } from './run/AuditTrail.tsx'
import { auditTrail } from '../core/derive/audit.ts'
import { FilterBar, SEARCH_INPUT_ID } from './run/FilterBar.tsx'
import { Timeline } from './timeline/Timeline.tsx'
import { descendantsOf } from '../core/derive/nesting.ts'
import { matchesFilters, queryTerms } from '../core/filter.ts'
import { groupItems, hitIds, stepHit } from './timeline/groups.ts'
import { ShortcutHelp } from './a11y/ShortcutHelp.tsx'
import { DetailPanel } from './detail/DetailPanel.tsx'
import { ComparePicker } from './compare/ComparePicker.tsx'
import { CompareView } from './compare/CompareView.tsx'
import { useGlobalKeys } from './a11y/useGlobalKeys.ts'
import { initialState, reducer, type AppState } from './state.ts'
import { ExportButtons } from './export/ExportButtons.tsx'
import { runMarkdown } from './export/markdown.ts'
import { linkHash, parseLink, type LinkTarget } from './link.ts'

const TIMELINE_SELECTOR = '.timeline'

export function App() {
  // A link's target is read before the first render, so the hash is not cleared before it is used.
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => ({ ...initialState, target: parseLink(location.hash) }))
  const [helpOpen, setHelpOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const load = (name: string, text: string) => dispatch({ type: 'loaded', name, text })
  const loadSample = (name: string, text: string) => dispatch({ type: 'loaded', name, text, sample: true })
  const onError = (message: string) => dispatch({ type: 'loadFailed', message })

  const run = state.file?.runs[state.runIndex]
  const audit = useMemo(() => (run ? auditTrail(run.approvals, run.endMs) : []), [run])

  // A link to a bundled sample opens it; a link to any other file waits for the reader to open that file.
  useEffect(() => {
    const open = (target: LinkTarget | undefined) => {
      if (!target) return
      dispatch({ type: 'linkOpened', target })
      const sample = target.sample ? SAMPLES.find((s) => s.file === target.sample) : undefined
      if (sample) void sample.load().then((text) => dispatch({ type: 'loaded', name: sample.file, text, sample: true }))
    }
    open(parseLink(location.hash))
    const onHashChange = () => open(parseLink(location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // The address bar always links to what is on screen: the file, the run, the open event and the search.
  const linkedEvent = state.detailOpen ? state.selectedId : undefined
  useEffect(() => {
    if (state.target) return
    const file = state.file
    const hash = file
      ? linkHash({ [file.sample ? 'sample' : 'file']: file.name, run: run?.id, event: linkedEvent, q: state.filters.text.trim() })
      : ''
    if (hash !== location.hash) history.replaceState(null, '', hash || location.pathname + location.search)
  }, [state.target, state.file, run, linkedEvent, state.filters.text])
  const groups = useMemo(() => (run ? groupItems(run.items, state.filters, state.collapsed) : []), [run, state.filters, state.collapsed])
  const shown = groups.reduce((n, g) => n + g.items.length - g.context.size, 0)
  // With a search in effect, the other runs in the file that have matches too.
  const otherMatches = useMemo(() => {
    const runs = state.file?.runs ?? []
    if (runs.length < 2 || queryTerms(state.filters.text).length === 0) return []
    return runs
      .map((r, index) => ({ index, id: r.id, count: r.items.filter((i) => matchesFilters(i, state.filters)).length }))
      .filter((m) => m.index !== state.runIndex && m.count > 0)
  }, [state.file, state.filters, state.runIndex])
  // Search matches in order, and moving the selection between them. A match
  // inside a collapsed step opens the step.
  const searching = queryTerms(state.filters.text).length > 0
  const hits = useMemo(() => (searching ? hitIds(groups) : []), [searching, groups])
  const stepToHit = useCallback((delta: 1 | -1) => {
    const order = groups.flatMap((g) => g.items.map((i) => i.id))
    const id = stepHit(order, hits, state.selectedId, delta)
    if (!id) return
    const key = groups.find((g) => g.items.some((i) => i.id === id))?.key
    if (key && state.collapsed.includes(key)) dispatch({ type: 'setCollapsed', key, collapsed: false })
    dispatch({ type: 'select', id })
    if (state.detailOpen) dispatch({ type: 'openDetail', id })
  }, [groups, hits, state.selectedId, state.collapsed, state.detailOpen])
  const detailItem = state.detailOpen ? run?.items.find((i) => i.id === state.selectedId) : undefined

  const keys = useMemo(
    () => ({
      '?': () => setHelpOpen((open) => !open),
      '/': () => document.getElementById(SEARCH_INPUT_ID)?.focus(),
      t: () => document.querySelector<HTMLElement>(TIMELINE_SELECTOR)?.focus(),
      e: () => dispatch({ type: 'setErrorsOnly', value: !state.filters.errorsOnly }),
      c: () => setBreakdownOpen((open) => !open),
      u: () => setAuditOpen((open) => !open),
      a: () => document.querySelector<HTMLElement>(`#${LANE_ID} [tabindex="0"]`)?.focus(),
      n: () => stepToHit(1),
      N: () => stepToHit(-1),
      Escape: () => {
        if (helpOpen) setHelpOpen(false)
        else if (state.comparing) dispatch({ type: 'stopCompare' })
        else if (state.detailOpen) dispatch({ type: 'closeDetail' })
        else if (document.activeElement?.id === SEARCH_INPUT_ID) document.querySelector<HTMLElement>(TIMELINE_SELECTOR)?.focus()
      },
    }),
    [helpOpen, state.comparing, state.detailOpen, state.filters.errorsOnly, stepToHit],
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
        {state.target && <PendingLink target={state.target} />}
        <SampleMenu onPick={loadSample} />
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
      {state.linkMiss && (
        <p role="status" className="notice">
          {state.linkMiss}
        </p>
      )}
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
          <CostBreakdown run={run} open={breakdownOpen} onToggle={setBreakdownOpen} onJump={(id) => dispatch({ type: 'openDetail', id })} />
          <AuditTrail run={run} entries={audit} open={auditOpen} onToggle={setAuditOpen} onJump={(id) => dispatch({ type: 'openDetail', id })} />
          <FilterBar
            run={run}
            filters={state.filters}
            shown={shown}
            onToggle={(category) => dispatch({ type: 'toggleCategory', category })}
            onErrorsOnly={(value) => dispatch({ type: 'setErrorsOnly', value })}
            onText={(text) => dispatch({ type: 'setText', text })}
            onClear={() => dispatch({ type: 'clearFilters' })}
            otherMatches={otherMatches}
            onSelectRun={(index) => dispatch({ type: 'selectRun', index })}
            hits={searching ? { index: hits.indexOf(state.selectedId ?? '') + 1, count: hits.length } : undefined}
            onStepHit={stepToHit}
          >
            <ExportButtons
              fileName={`${run.id.replace(/[^\w.-]+/g, '_')}.md`}
              markdown={() =>
                runMarkdown({
                  run,
                  fileName: file.name,
                  filters: state.filters,
                  link: `${location.origin}${location.pathname}${linkHash({ [file.sample ? 'sample' : 'file']: file.name, run: run.id })}`,
                })
              }
            />
          </FilterBar>
          <ApprovalsLane run={run} entries={audit} selectedId={state.selectedId} onJump={(id) => dispatch({ type: 'openDetail', id })} />
          <div className={`workspace${detailItem ? ' workspace--split' : ''}`}>
          <Timeline
            run={run}
            groups={groups}
            collapsed={state.collapsed}
            selectedId={state.selectedId}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onOpen={(id) => dispatch({ type: 'openDetail', id })}
            terms={queryTerms(state.filters.text)}
            onCollapse={(key, collapsed) => {
              dispatch({ type: 'setCollapsed', key, collapsed })
              // Folding a sub-agent that holds the selection moves the selection to the folded row.
              const parentId = key.startsWith('sub:') ? key.slice(4) : undefined
              if (collapsed && parentId && descendantsOf(run.items, parentId).some((i) => i.id === state.selectedId)) {
                dispatch({ type: 'select', id: parentId })
              }
            }}
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

function PendingLink({ target }: { target: LinkTarget }) {
  const where = [target.event && `event ${target.event}`, target.run && `run ${target.run}`].filter(Boolean).join(' in ')
  const name = target.file ?? target.sample
  return (
    <p role="status" className="notice">
      This link points to {where || 'a run'}
      {name && (
        <>
          {' '}
          of <span className="mono">{name}</span>
        </>
      )}
      . Open that file to jump there. The log itself is never part of a link.
    </p>
  )
}
