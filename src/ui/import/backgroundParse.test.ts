import { describe, expect, it, vi } from 'vitest'
import { loadLog } from '../../core/load.ts'
import { ev } from '../../test/helpers.ts'
import otel from '../../../samples/otel-support-refund.json?raw'
import { ParseCancelled, parseInBackground, type WorkerLike } from './backgroundParse.ts'
import { handleParseRequest, type ParseRequest, type ParseResponse } from './parseRequest.ts'

const TEXT = [ev({ type: 'log', id: 'a', message: 'm' }), 'not json', ev({ type: 'log', id: 'b', run_id: 'r2', message: 'm' })].join('\n')

async function responses(request: ParseRequest): Promise<ParseResponse[]> {
  const out: ParseResponse[] = []
  await handleParseRequest(request, (m) => out.push(m))
  return out
}

// A stand-in for the real worker: runs the same request handler and delivers
// each message on its own task, through structuredClone, as postMessage would.
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<ParseResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  posted: ParseRequest[] = []
  constructor(private readonly behaviour: 'parse' | 'crash' | 'hang' = 'parse') {}
  postMessage(message: ParseRequest) {
    this.posted.push(message)
    if (this.behaviour === 'hang') return
    if (this.behaviour === 'crash') {
      setTimeout(() => this.onerror?.({ message: 'Out of memory', preventDefault: () => {} } as unknown as ErrorEvent), 0)
      return
    }
    void handleParseRequest(message, (data) => {
      const copy = structuredClone(data)
      setTimeout(() => {
        if (!this.terminated) this.onmessage?.({ data: copy } as MessageEvent<ParseResponse>)
      }, 0)
    })
  }
  terminate() {
    this.terminated = true
  }
}

describe('handleParseRequest', () => {
  it('parses text and ends with the runs and issues', async () => {
    const out = await responses({ source: TEXT })
    const done = out.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.format).toBe('jsonl')
    expect(done.runs.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(done.issues).toHaveLength(1)
  })

  it('reads a File or Blob itself, so the page never holds the text', async () => {
    const out = await responses({ source: new Blob([TEXT]) })
    expect(out.at(-1)?.type).toBe('done')
  })

  it('reports a file it cannot read instead of throwing', async () => {
    const broken = { text: () => Promise.reject(new Error('The file was moved')) } as unknown as Blob
    expect(await responses({ source: broken })).toEqual([{ type: 'error', message: 'The file was moved' }])
  })
})

describe('parseInBackground', () => {
  it('resolves with what the worker parsed, then terminates it', async () => {
    const worker = new FakeWorker()
    const file = new File([otel], 'trace.json')
    const parsed = await parseInBackground(file, () => worker).promise
    expect(parsed).toEqual(loadLog(otel))
    expect(worker.posted[0]?.source).toBe(file)
    expect(worker.terminated).toBe(true)
  })

  it('cancels by terminating the worker', async () => {
    const worker = new FakeWorker('hang')
    const job = parseInBackground(TEXT, () => worker)
    job.cancel()
    await expect(job.promise).rejects.toBeInstanceOf(ParseCancelled)
    expect(worker.terminated).toBe(true)
  })

  it('ignores messages that arrive after cancelling', async () => {
    const worker = new FakeWorker()
    const job = parseInBackground(TEXT, () => worker)
    job.cancel()
    await expect(job.promise).rejects.toBeInstanceOf(ParseCancelled)
  })

  it('rejects with the reason when the worker dies, for example out of memory', async () => {
    const worker = new FakeWorker('crash')
    await expect(parseInBackground(TEXT, () => worker).promise).rejects.toThrow('Out of memory')
    expect(worker.terminated).toBe(true)
  })

  it('parses on the main thread where workers are unavailable, after yielding once', async () => {
    vi.useFakeTimers()
    try {
      const job = parseInBackground(TEXT, undefined)
      let done = false
      void job.promise.then(() => (done = true))
      await Promise.resolve()
      expect(done).toBe(false)
      await vi.runAllTimersAsync()
      expect((await job.promise).runs).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('can cancel the main-thread fallback before it starts', async () => {
    const job = parseInBackground(TEXT, undefined)
    job.cancel()
    await expect(job.promise).rejects.toBeInstanceOf(ParseCancelled)
  })
})
