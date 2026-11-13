import { parseJsonl, type ParseResult } from './jsonl.ts'
import { isOtlpJson, parseOtlp } from './otel.ts'
import { isLangSmithJson, parseLangSmith } from './langsmith.ts'
import { isOpenAiAgentsJson, parseOpenAiAgents } from './openai-agents.ts'

export type LogFormat = 'jsonl' | 'otlp' | 'langsmith' | 'openai-agents'

export const FORMAT_LABELS: Record<LogFormat, string> = {
  jsonl: 'Trailview JSONL',
  otlp: 'OpenTelemetry (OTLP JSON)',
  langsmith: 'LangSmith runs',
  'openai-agents': 'OpenAI Agents SDK trace',
}

// Picks the parser from the file's content, not its name, so a renamed file still loads.
export function parseLog(text: string): ParseResult & { format: LogFormat } {
  if (startsWithTrailviewEvent(text)) return { format: 'jsonl', ...parseJsonl(text) }
  if (isOtlpJson(text)) return { format: 'otlp', ...parseOtlp(text) }
  if (isOpenAiAgentsJson(text)) return { format: 'openai-agents', ...parseOpenAiAgents(text) }
  if (isLangSmithJson(text)) return { format: 'langsmith', ...parseLangSmith(text) }
  return { format: 'jsonl', ...parseJsonl(text) }
}

// The other formats are recognised by keys near the top of the file, which a
// Trailview log can also hold inside a payload (an agent that reads traces
// logs them as tool output). A first line that is a whole Trailview event, with
// a type and a run_id, settles it. Very long first lines are left to the key
// checks, so a large one-line export is not parsed twice.
const MAX_FIRST_LINE = 1_000_000

function startsWithTrailviewEvent(text: string): boolean {
  const start = text.replace(/^\uFEFF/, '').trimStart()
  if (!start.startsWith('{')) return false
  const end = start.indexOf('\n')
  const first = (end === -1 ? start : start.slice(0, end)).trimEnd()
  if (first.length > MAX_FIRST_LINE || !first.endsWith('}')) return false
  try {
    const value = JSON.parse(first) as unknown
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).type === 'string' &&
      typeof (value as Record<string, unknown>).run_id === 'string'
    )
  } catch {
    return false
  }
}
