import type { Loading } from '../state.ts'
import { formatBytes } from '../format.ts'

// Says which file is being read while the parse worker runs, with a way to stop it.
export function LoadingStatus({ loading, onCancel }: { loading: Loading; onCancel: () => void }) {
  return (
    <div className="loading-status" role="status" aria-live="polite">
      <span className="loading-status__spinner" aria-hidden="true" />
      <span>
        Reading {loading.name} ({formatBytes(loading.bytes)})…
      </span>
      <button type="button" className="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
