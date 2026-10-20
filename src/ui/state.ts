import type { ParseIssue } from '../core/parse/jsonl.ts'
import { parseLog, type LogFormat } from '../core/parse/detect.ts'
import { buildRuns, type Run } from '../core/model/run.ts'
import { NO_FILTERS, type Category, type Filters } from '../core/filter.ts'

export interface LoadedFile {
  name: string
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
}

export type AppAction =
  | { type: 'loaded'; name: string; text: string }
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

export const initialState: AppState = { runIndex: 0, filters: NO_FILTERS, detailOpen: false, collapsed: [] }

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'loaded': {
      const { format, events, issues } = parseLog(action.text)
      return { ...initialState, file: { name: action.name, format, runs: buildRuns(events), issues } }
    }
    case 'loadFailed':
      return { ...state, loadError: action.message }
    case 'selectRun':
      return { ...state, runIndex: action.index, selectedId: undefined, detailOpen: false, collapsed: [] }
    case 'close':
      return initialState
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
