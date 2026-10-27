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
    file: 'oncall-digest-two-versions.jsonl',
    title: 'Two runs to compare: on-call digest v0.4.2 and v0.4.3, which skips the rejected email',
    load: () => text(import('../../../samples/oncall-digest-two-versions.jsonl?raw')),
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
    file: 'dev-lead-subagents.jsonl',
    title: 'Coding lead with sub-agents: an explorer (with its own helper) and a test runner that retries an install',
    load: () => text(import('../../../samples/dev-lead-subagents.jsonl?raw')),
  },
  {
    file: 'backfill-crashed.jsonl',
    title: 'Data backfill agent: the worker dies mid-extract, leaving a call that never finished',
    load: () => text(import('../../../samples/backfill-crashed.jsonl?raw')),
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
  {
    file: 'openai-agents-support-triage.json',
    title: 'OpenAI Agents SDK trace: triage hands a damaged-order refund to another agent, which waits for approval',
    load: () => text(import('../../../samples/openai-agents-support-triage.json?raw')),
  },
]
