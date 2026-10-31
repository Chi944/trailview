import type { ParsedLog } from '../../core/load.ts'
import { LogReceiver } from '../../core/transfer.ts'
import { handleParseRequest, type ParseRequest, type ParseResponse } from './parseRequest.ts'

// The part of the Worker API this module uses, so tests can pass a fake.
export interface WorkerLike {
  onmessage: ((e: MessageEvent<ParseResponse>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  postMessage: (message: ParseRequest) => void
  terminate: () => void
}

export type WorkerFactory = () => WorkerLike

export interface ParseJob {
  promise: Promise<ParsedLog>
  // Stops the parse. The promise then rejects with a ParseCancelled error.
  cancel: () => void
}

export class ParseCancelled extends Error {
  constructor() {
    super('Parse cancelled')
    this.name = 'ParseCancelled'
  }
}

const defaultFactory: WorkerFactory | undefined =
  typeof Worker === 'undefined'
    ? undefined
    : () => new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike

// Parses a log in a Web Worker and resolves with the runs. Where workers are
// unavailable it parses on the main thread instead, after yielding once so the
// page can show that it is busy.
export function parseInBackground(source: File | Blob | string, makeWorker: WorkerFactory | undefined = defaultFactory): ParseJob {
  let settled = false
  let reject: (err: Error) => void = () => {}
  let worker: WorkerLike | undefined
  const promise = new Promise<ParsedLog>((resolve, rejectPromise) => {
    reject = rejectPromise
    const receiver = new LogReceiver()
    const fail = (message: string) => {
      if (settled) return
      settled = true
      worker?.terminate()
      rejectPromise(new Error(message))
    }
    const onMessage = (message: ParseResponse) => {
      if (settled) return
      if (message.type === 'error') return fail(message.message)
      let parsed: ParsedLog | undefined
      try {
        parsed = receiver.receive(message)
      } catch (err) {
        return fail((err as Error).message)
      }
      if (!parsed) return
      settled = true
      worker?.terminate()
      resolve(parsed)
    }
    if (!makeWorker) {
      setTimeout(() => {
        if (!settled) void handleParseRequest({ source }, onMessage)
      }, 0)
      return
    }
    worker = makeWorker()
    worker.onmessage = (e) => onMessage(e.data)
    worker.onerror = (e) => {
      e.preventDefault?.()
      fail(e.message || 'The parser stopped unexpectedly')
    }
    worker.postMessage({ source })
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker?.terminate()
      reject(new ParseCancelled())
    },
  }
}
