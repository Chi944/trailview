import type { ParseIssue } from './parse/jsonl.ts'
import { parseLog, type LogFormat } from './parse/detect.ts'
import { buildRuns, type Run } from './model/run.ts'

// Everything the viewer needs from one log file. It holds only plain data, so a
// Web Worker can build it and post it back to the page.
export interface ParsedLog {
  format: LogFormat
  runs: Run[]
  issues: ParseIssue[]
}

export function loadLog(text: string): ParsedLog {
  const { format, events, issues } = parseLog(text)
  return { format, runs: buildRuns(events), issues }
}
