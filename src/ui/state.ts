import { parseJsonl, type ParseIssue } from '../core/parse/jsonl.ts'
import { buildRuns, type Run } from '../core/model/run.ts'

export interface LoadedFile {
  name: string
  runs: Run[]
  issues: ParseIssue[]
}

export interface AppState {
  file?: LoadedFile
  runIndex: number
  loadError?: string
}

export type AppAction =
  | { type: 'loaded'; name: string; text: string }
  | { type: 'loadFailed'; message: string }
  | { type: 'selectRun'; index: number }
  | { type: 'close' }

export const initialState: AppState = { runIndex: 0 }

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'loaded': {
      const { events, issues } = parseJsonl(action.text)
      return { file: { name: action.name, runs: buildRuns(events), issues }, runIndex: 0 }
    }
    case 'loadFailed':
      return { ...state, loadError: action.message }
    case 'selectRun':
      return { ...state, runIndex: action.index }
    case 'close':
      return initialState
  }
}
