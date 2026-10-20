// Sample runs are loaded only when picked, so they stay out of the main bundle.
export interface Sample {
  file: string
  title: string
  load: () => Promise<string>
}

const text = (module: Promise<{ default: string }>) => module.then((m) => m.default)

export const SAMPLES: Sample[] = [
  {
    file: 'oncall-digest.jsonl',
    title: 'On-call digest: a retried lookup, then a rejected and an approved email',
    load: () => text(import('../../../samples/oncall-digest.jsonl?raw')),
  },
  {
    file: 'patchbot-failed.jsonl',
    title: 'Coding agent: fails a test fix and hits its step limit (estimated cost)',
    load: () => text(import('../../../samples/patchbot-failed.jsonl?raw')),
  },
  {
    file: 'research-brief.jsonl',
    title: 'Research agent: 40+ calls with caching, a timeout and a policy approval',
    load: () => text(import('../../../samples/research-brief.jsonl?raw')),
  },
  {
    file: 'otel-support-refund.json',
    title: 'OpenTelemetry trace: a support agent retries an overloaded call and gets a refund approved',
    load: () => text(import('../../../samples/otel-support-refund.json?raw')),
  },
  {
    file: 'langsmith-sql-analyst.json',
    title: 'LangSmith export: a LangGraph SQL agent fixes a bad query and posts to Slack after approval',
    load: () => text(import('../../../samples/langsmith-sql-analyst.json?raw')),
  },
]
