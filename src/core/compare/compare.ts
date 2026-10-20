import { callCost } from '../derive/totals.ts'
import type { Totals } from '../derive/totals.ts'
import type { Run } from '../model/run.ts'

// Side-by-side comparison of two runs: their totals, and their steps paired
// by step number. Used to see what changed between two runs of an agent.

export interface TotalsRow {
  key: keyof Totals
  label: string
  a: number
  b: number
  // b - a.
  delta: number
  // Whether a drop is an improvement; false for counts that are neither good nor bad.
  lowerIsBetter: boolean
}

const COMPARED: [keyof Totals, string][] = [
  ['wallMs', 'Duration'],
  ['costUsd', 'Cost'],
  ['inputTokens', 'Tokens in'],
  ['outputTokens', 'Tokens out'],
  ['cacheReadTokens', 'Cache read'],
  ['cacheWriteTokens', 'Cache write'],
  ['modelCalls', 'Model calls'],
  ['toolCalls', 'Tool calls'],
  ['retries', 'Retries'],
  ['errors', 'Errors'],
  ['approvals', 'Approvals'],
  ['rejections', 'Rejections'],
  ['waitMs', 'Waiting on approvals'],
]

export function compareTotals(a: Totals, b: Totals): TotalsRow[] {
  return COMPARED.map(([key, label]) => {
    const av = Number(a[key])
    const bv = Number(b[key])
    return { key, label, a: av, b: bv, delta: bv - av, lowerIsBetter: key !== 'approvals' }
  })
}

export interface StepSummary {
  step: number
  models: string[]
  // Tool names in call order, retries counted once.
  tools: string[]
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
  errors: number
  approvals: { action: string; decision?: 'approved' | 'rejected' }[]
}

export function summarizeSteps(run: Run): StepSummary[] {
  const steps = new Map<number, StepSummary & { startMs: number; endMs: number }>()
  const get = (step: number, ts: number) => {
    let summary = steps.get(step)
    if (!summary) {
      summary = { step, models: [], tools: [], inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, errors: 0, approvals: [], startMs: ts, endMs: ts }
      steps.set(step, summary)
    }
    return summary
  }

  for (const parsed of run.events) {
    if (parsed.kind !== 'known') continue
    const event = parsed.event
    if (event.step === undefined) continue
    const ts = Date.parse(event.ts)
    const summary = get(event.step, ts)
    const duration = 'duration_ms' in event && typeof event.duration_ms === 'number' ? event.duration_ms : 0
    summary.startMs = Math.min(summary.startMs, ts)
    summary.endMs = Math.max(summary.endMs, ts + duration)
    if (event.type === 'model.call') {
      if (!summary.models.includes(event.model)) summary.models.push(event.model)
      summary.inputTokens += event.usage?.input_tokens ?? 0
      summary.outputTokens += event.usage?.output_tokens ?? 0
      summary.costUsd += callCost(event, run.pricing)?.usd ?? 0
      if (event.status === 'error') summary.errors++
    } else if (event.type === 'tool.call') {
      if (!event.retry_of) summary.tools.push(event.tool)
      if (event.status === 'error') summary.errors++
    } else if (event.type === 'error') {
      summary.errors++
    }
  }

  for (const approval of run.approvals) {
    const step = approval.request?.step ?? approval.decision?.step
    if (step === undefined) continue
    const summary = steps.get(step)
    summary?.approvals.push({ action: approval.request?.action ?? 'action', decision: approval.outcome === 'pending' ? undefined : approval.outcome })
  }

  return [...steps.values()]
    .sort((x, y) => x.step - y.step)
    .map(({ startMs, endMs, ...summary }) => ({ ...summary, durationMs: endMs - startMs }))
}

export interface StepPair {
  a?: StepSummary
  b?: StepSummary
  // The two runs did something different here: a step only one run took, or
  // matching steps whose approvals ended differently.
  differs: boolean
}

export interface RunComparison {
  totals: TotalsRow[]
  steps: StepPair[]
  // The first pair where the runs differ, if any.
  divergence?: StepPair
}

// Steps are aligned by what they did (models and tools called), not by number,
// so a step one run added or skipped does not shift every step after it.
export function compareRuns(a: Run, b: Run): RunComparison {
  const steps = alignSteps(summarizeSteps(a), summarizeSteps(b))
  return { totals: compareTotals(a.totals, b.totals), steps, divergence: steps.find((s) => s.differs) }
}

export function alignSteps(a: StepSummary[], b: StepSummary[]): StepPair[] {
  const keyA = a.map(actionKey)
  const keyB = b.map(actionKey)
  // Longest common subsequence of step keys; lcs[i][j] covers a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = keyA[i] === keyB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const pairs: StepPair[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && keyA[i] === keyB[j]) {
      pairs.push({ a: a[i], b: b[j], differs: approvalKey(a[i]!) !== approvalKey(b[j]!) })
      i++
      j++
    } else if (j >= b.length || (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      pairs.push({ a: a[i++], differs: true })
    } else {
      pairs.push({ b: b[j++], differs: true })
    }
  }
  return pairs
}

const actionKey = (step: StepSummary) => JSON.stringify([step.models, step.tools])
const approvalKey = (step: StepSummary) => JSON.stringify(step.approvals)
