import { useCallback, useEffect, useRef, type Dispatch } from 'react'
import type { AppAction, Loading } from '../state.ts'
import { ParseCancelled, parseInBackground, type ParseJob } from './backgroundParse.ts'

export interface LoadRequest {
  name: string
  source: File | Blob | string
  side: Loading['side']
  sample?: boolean
}

// Parses opened files in a Web Worker and dispatches the result, one file at a
// time: opening another file, or the reducer dropping `loading`, cancels the one
// in progress.
export function useLogLoader(dispatch: Dispatch<AppAction>, loading: Loading | undefined) {
  const job = useRef<ParseJob | undefined>(undefined)

  const cancel = useCallback(() => {
    job.current?.cancel()
    job.current = undefined
  }, [])

  const start = useCallback(
    ({ name, source, side, sample }: LoadRequest) => {
      cancel()
      const bytes = typeof source === 'string' ? source.length : source.size
      dispatch({ type: 'loadStarted', loading: { name, bytes, side } })
      const current = parseInBackground(source)
      job.current = current
      current.promise.then(
        (parsed) => {
          if (job.current !== current) return
          job.current = undefined
          dispatch(side === 'main' ? { type: 'loaded', name, parsed, sample } : { type: 'compareLoaded', name, parsed })
        },
        (err: Error) => {
          if (err instanceof ParseCancelled || job.current !== current) return
          job.current = undefined
          dispatch({ type: 'loadFailed', message: `Could not read ${name}: ${err.message}` })
        },
      )
    },
    [cancel, dispatch],
  )

  // The reducer drops `loading` when the view it was for goes away.
  useEffect(() => {
    if (!loading) cancel()
  }, [loading, cancel])
  useEffect(() => cancel, [cancel])

  const stop = useCallback(() => {
    cancel()
    dispatch({ type: 'loadCancelled' })
  }, [cancel, dispatch])

  return { start, stop }
}
