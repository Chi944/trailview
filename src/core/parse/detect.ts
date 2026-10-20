import { parseJsonl, type ParseResult } from './jsonl.ts'
import { isOtlpJson, parseOtlp } from './otel.ts'

export type LogFormat = 'jsonl' | 'otlp'

export const FORMAT_LABELS: Record<LogFormat, string> = {
  jsonl: 'Trailview JSONL',
  otlp: 'OpenTelemetry (OTLP JSON)',
}

// Picks the parser from the file's content, not its name, so a renamed file still loads.
export function parseLog(text: string): ParseResult & { format: LogFormat } {
  if (isOtlpJson(text)) return { format: 'otlp', ...parseOtlp(text) }
  return { format: 'jsonl', ...parseJsonl(text) }
}
