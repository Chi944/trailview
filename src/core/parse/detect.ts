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
  if (isOtlpJson(text)) return { format: 'otlp', ...parseOtlp(text) }
  if (isOpenAiAgentsJson(text)) return { format: 'openai-agents', ...parseOpenAiAgents(text) }
  if (isLangSmithJson(text)) return { format: 'langsmith', ...parseLangSmith(text) }
  return { format: 'jsonl', ...parseJsonl(text) }
}
