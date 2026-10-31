import type { ParseIssue } from '../core/parse/jsonl.ts'
import type { LogFormat } from '../core/parse/detect.ts'
import type { Run } from '../core/model/run.ts'
import { loadLog, type ParsedLog } from '../core/load.ts'
import { NO_FILTERS, type Category, type Filters } from '../core/filter.ts'
import type { LinkTarget } from './link.ts'

export interface LoadedFile {
  name: string
  // True for a bundled sample, so links to it can reopen it.
  sample?: boolean
  format: LogFormat
  runs: Run[]
  issues: ParseIssue[]
}

export interface AppState {
  file?: LoadedFile
  runIndex: number
  loadError?: string
  filters: Filters
  // Timeline item id currently selected, and whether its detail panel is open.
  selectedId?: string
  detailOpen: boolean
  // Step group keys the user collapsed.
  collapsed: string[]
  // Compare mode: true while picking or viewing a comparison; `compare` is the other run's file.
  comparing: boolean
  compare?: CompareSide
  // A link the page was opened with, waiting for its file; and what went wrong applying one.
  target?: LinkTarget
  linkMiss?: string
  // A file being parsed in the background, and which side it is for.
  loading?: Loading
}

export interface Loading {
  name: string
  bytes: number
  side: 'main' | 'compare'
}

// A loaded file arrives either already parsed (from the parse worker) or as text.
type LogSource = { text: string } | { parsed: ParsedLog }

function parsedFrom(source: LogSource): ParsedLog {
  return 'parsed' in source ? source.parsed : loadLog(source.text)
}

// The run compared against the current one, and the file it came from.
export interface CompareSide {
  name: string
  format: LogFormat
  runs: Run[]
  runIndex: number
}

export type AppAction =
  | ({ type: 'loaded'; name: string; sample?: boolean } & LogSource)
  | { type: 'loadStarted'; loading: Loading }
  | { type: 'loadCancelled' }
  | { type: 'linkOpened'; target: LinkTarget }
  | { type: 'loadFailed'; message: string }
  | { type: 'selectRun'; index: number }
  | { type: 'close' }
  | { type: 'toggleCategory'; category: Category }
  | { type: 'setErrorsOnly'; value: boolean }
  | { type: 'setText'; text: string }
  | { type: 'clearFilters' }
  | { type: 'select'; id: string | undefined }
  | { type: 'openDetail'; id?: string }
  | { type: 'closeDetail' }
  | { type: 'setCollapsed'; key: string; collapsed: boolean }
  | { type: 'startCompare' }
  | { type: 'stopCompare' }
  | { type: 'compareWithRun'; index: number }
  | ({ type: 'compareLoaded'; name: string } & LogSource)
  | { type: 'selectCompareRun'; index: number }
  | { type: 'changeCompare' }

// Opens the run and event a link names in the loaded file, expanding and
// unfiltering so the event is in view, then applies the link's search. Says
// so when the file lacks them.
export function applyTarget(state: AppState, target: LinkTarget): AppState {
  const file = state.file
  if (!file) return { ...state, target }
  const base: AppState = { ...state, target: undefined, linkMiss: undefined, comparing: false, compare: undefined }
  const runIndex = target.run ? file.runs.findIndex((r) => r.id === target.run) : 0
  if (runIndex < 0) return { ...base, linkMiss: `The link points to run ${target.run}, which is not in ${file.name}.` }
  const run = file.runs[runIndex]!
  const atRun = { ...base, runIndex, selectedId: undefined, detailOpen: false, collapsed: [], filters: { ...NO_FILTERS, text: target.q ?? '' } }
  if (!target.event) return atRun
  const item = run.items.find((i) => i.events.some((e) => e.event.id === target.event))
  if (!item) return { ...atRun, linkMiss: `The link points to event ${target.event}, which is not in run ${run.id}.` }
  return { ...atRun, selectedId: item.id, detailOpen: true }
}

export const initialState: AppState = { runIndex: 0, filters: NO_FILTERS, detailOpen: false, collapsed: [], comparing: false }

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'loaded': {
      const { format, runs, issues } = parsedFrom(action)
      const loaded: AppState = { ...initialState, file: { name: action.name, format, runs, issues, sample: action.sample } }
      return state.target ? applyTarget(loaded, state.target) : loaded
    }
    case 'linkOpened':
      return state.file ? applyTarget(state, action.target) : { ...state, target: action.target, linkMiss: undefined }
    case 'loadStarted':
      return { ...state, loading: action.loading, loadError: undefined }
    case 'loadCancelled':
      return { ...state, loading: undefined }
    case 'loadFailed':
      return { ...state, loading: undefined, loadError: action.message }
    case 'selectRun':
      return { ...state, runIndex: action.index, selectedId: undefined, detailOpen: false, collapsed: [] }
    case 'close':
      return initialState
    case 'startCompare':
      return { ...state, comparing: true, detailOpen: false }
    case 'stopCompare':
      return { ...state, comparing: false, compare: undefined, loading: state.loading?.side === 'compare' ? undefined : state.loading }
    case 'changeCompare':
      return { ...state, compare: undefined }
    case 'compareWithRun': {
      if (!state.file) return state
      const { name, format, runs } = state.file
      return { ...state, compare: { name, format, runs, runIndex: action.index } }
    }
    case 'compareLoaded': {
      const { format, runs } = parsedFrom(action)
      if (runs.length === 0) return { ...state, loading: undefined, loadError: `No runs found in ${action.name}` }
      return { ...state, loading: undefined, loadError: undefined, compare: { name: action.name, format, runs, runIndex: 0 } }
    }
    case 'selectCompareRun':
      return state.compare ? { ...state, compare: { ...state.compare, runIndex: action.index } } : state
    case 'toggleCategory': {
      const hidden = state.filters.hidden.includes(action.category)
        ? state.filters.hidden.filter((c) => c !== action.category)
        : [...state.filters.hidden, action.category]
      return { ...state, filters: { ...state.filters, hidden } }
    }
    case 'setErrorsOnly':
      return { ...state, filters: { ...state.filters, errorsOnly: action.value } }
    case 'setText':
      return { ...state, filters: { ...state.filters, text: action.text } }
    case 'clearFilters':
      return { ...state, filters: NO_FILTERS }
    case 'select':
      return { ...state, selectedId: action.id }
    case 'openDetail':
      return { ...state, selectedId: action.id ?? state.selectedId, detailOpen: (action.id ?? state.selectedId) !== undefined }
    case 'closeDetail':
      return { ...state, detailOpen: false }
    case 'setCollapsed': {
      const rest = state.collapsed.filter((k) => k !== action.key)
      return { ...state, collapsed: action.collapsed ? [...rest, action.key] : rest }
    }
  }
}
