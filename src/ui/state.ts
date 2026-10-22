import type { ParseIssue } from '../core/parse/jsonl.ts'
import { parseLog, type LogFormat } from '../core/parse/detect.ts'
import { buildRuns, type Run } from '../core/model/run.ts'
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
}

// The run compared against the current one, and the file it came from.
export interface CompareSide {
  name: string
  format: LogFormat
  runs: Run[]
  runIndex: number
}

export type AppAction =
  | { type: 'loaded'; name: string; text: string; sample?: boolean }
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
  | { type: 'compareLoaded'; name: string; text: string }
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
      const { format, events, issues } = parseLog(action.text)
      const loaded: AppState = { ...initialState, file: { name: action.name, format, runs: buildRuns(events), issues, sample: action.sample } }
      return state.target ? applyTarget(loaded, state.target) : loaded
    }
    case 'linkOpened':
      return state.file ? applyTarget(state, action.target) : { ...state, target: action.target, linkMiss: undefined }
    case 'loadFailed':
      return { ...state, loadError: action.message }
    case 'selectRun':
      return { ...state, runIndex: action.index, selectedId: undefined, detailOpen: false, collapsed: [] }
    case 'close':
      return initialState
    case 'startCompare':
      return { ...state, comparing: true, detailOpen: false }
    case 'stopCompare':
      return { ...state, comparing: false, compare: undefined }
    case 'changeCompare':
      return { ...state, compare: undefined }
    case 'compareWithRun': {
      if (!state.file) return state
      const { name, format, runs } = state.file
      return { ...state, compare: { name, format, runs, runIndex: action.index } }
    }
    case 'compareLoaded': {
      const { format, events } = parseLog(action.text)
      const runs = buildRuns(events)
      if (runs.length === 0) return { ...state, loadError: `No runs found in ${action.name}` }
      return { ...state, loadError: undefined, compare: { name: action.name, format, runs, runIndex: 0 } }
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
