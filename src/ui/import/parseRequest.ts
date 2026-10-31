import { loadLog } from '../../core/load.ts'
import { encodeLog, type TransferMessage } from '../../core/transfer.ts'

// The messages between the page and the parse worker.
export interface ParseRequest {
  // A File is posted as a handle, so the worker reads it and the page never
  // holds the text.
  source: File | Blob | string
}

export type ParseResponse = TransferMessage | { type: 'error'; message: string }

// What the worker does with one request: read, parse, then post the result in
// pieces (see core/transfer.ts). Kept apart from the worker's message wiring so
// tests can run it directly.
export async function handleParseRequest({ source }: ParseRequest, post: (message: ParseResponse) => void): Promise<void> {
  let parsed
  try {
    const text = typeof source === 'string' ? source : await source.text()
    parsed = loadLog(text)
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) })
    return
  }
  for (const message of encodeLog(parsed)) post(message)
}
