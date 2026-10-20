import oncallDigest from '../../../samples/oncall-digest.jsonl?raw'
import patchbotFailed from '../../../samples/patchbot-failed.jsonl?raw'
import researchBrief from '../../../samples/research-brief.jsonl?raw'
import otelSupportRefund from '../../../samples/otel-support-refund.json?raw'
import langsmithSqlAnalyst from '../../../samples/langsmith-sql-analyst.json?raw'

export interface Sample {
  file: string
  title: string
  text: string
}

export const SAMPLES: Sample[] = [
  { file: 'oncall-digest.jsonl', title: 'On-call digest: a retried lookup, then a rejected and an approved email', text: oncallDigest },
  { file: 'patchbot-failed.jsonl', title: 'Coding agent: fails a test fix and hits its step limit (estimated cost)', text: patchbotFailed },
  { file: 'research-brief.jsonl', title: 'Research agent: 40+ calls with caching, a timeout and a policy approval', text: researchBrief },
  { file: 'otel-support-refund.json', title: 'OpenTelemetry trace: a support agent retries an overloaded call and gets a refund approved', text: otelSupportRefund },
  { file: 'langsmith-sql-analyst.json', title: 'LangSmith export: a LangGraph SQL agent fixes a bad query and posts to Slack after approval', text: langsmithSqlAnalyst },
]
