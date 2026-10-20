import { z } from 'zod'

// Trailview JSONL event schema, version 1. See docs/schema.md.
// Objects are loose: unknown fields are kept so the raw view can show them.

export const SCHEMA_VERSION = 1

const isoTimestamp = z.iso.datetime({ offset: true })
const nonEmpty = z.string().min(1)
const count = z.number().int().nonnegative()

export const errorInfoSchema = z.looseObject({
  type: nonEmpty,
  message: z.string(),
  retryable: z.boolean().optional(),
  code: z.union([z.string(), z.number()]).optional(),
})

export const envelopeSchema = z.looseObject({
  type: nonEmpty,
  run_id: nonEmpty,
  id: nonEmpty,
  ts: isoTimestamp,
  step: z.number().int().min(1).optional(),
  parent_id: nonEmpty.optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
})

// Fields shared by calls that can be retried.
const retryFields = {
  attempt: z.number().int().min(1).optional(),
  retry_of: nonEmpty.optional(),
  error: errorInfoSchema.optional(),
}

export const runStartSchema = envelopeSchema.extend({
  type: z.literal('run.start'),
  v: z.number().int().min(1),
  agent: z.looseObject({ name: nonEmpty, version: z.string().optional() }),
  input: z.unknown().optional(),
  pricing: z
    .record(
      z.string(),
      z.looseObject({
        input_per_mtok: z.number().nonnegative(),
        output_per_mtok: z.number().nonnegative(),
        cache_read_per_mtok: z.number().nonnegative().optional(),
        cache_write_per_mtok: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
})

export const runEndSchema = envelopeSchema.extend({
  type: z.literal('run.end'),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  output: z.unknown().optional(),
  error: errorInfoSchema.optional(),
})

export const toolCallRequestSchema = z.looseObject({
  id: nonEmpty,
  name: nonEmpty,
  input: z.unknown().optional(),
})

export const usageSchema = z.looseObject({
  input_tokens: count,
  output_tokens: count,
  cache_read_tokens: count.optional(),
  cache_write_tokens: count.optional(),
})

export const modelCallSchema = envelopeSchema.extend({
  type: z.literal('model.call'),
  provider: nonEmpty,
  model: nonEmpty,
  duration_ms: count,
  status: z.enum(['ok', 'error']),
  input: z.unknown().optional(),
  output: z
    .looseObject({ text: z.string().optional(), tool_calls: z.array(toolCallRequestSchema).optional() })
    .optional(),
  stop_reason: z.string().optional(),
  usage: usageSchema.optional(),
  cost_usd: z.number().nonnegative().optional(),
  // The id of the model.start line this call finishes, if one was written.
  start_id: nonEmpty.optional(),
  ...retryFields,
})

export const toolCallSchema = envelopeSchema.extend({
  type: z.literal('tool.call'),
  tool: nonEmpty,
  call_id: nonEmpty.optional(),
  duration_ms: count,
  status: z.enum(['ok', 'error']),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  approval_id: nonEmpty.optional(),
  start_id: nonEmpty.optional(),
  ...retryFields,
})

// Optional lines written when a call begins, so a call that never returns
// (the process crashed or was killed) still shows up. Once the finished call
// arrives it is the record and the start line is folded into it.
export const modelStartSchema = envelopeSchema.extend({
  type: z.literal('model.start'),
  provider: nonEmpty,
  model: nonEmpty,
  input: z.unknown().optional(),
  attempt: z.number().int().min(1).optional(),
  retry_of: nonEmpty.optional(),
})

export const toolStartSchema = envelopeSchema.extend({
  type: z.literal('tool.start'),
  tool: nonEmpty,
  call_id: nonEmpty.optional(),
  input: z.unknown().optional(),
  approval_id: nonEmpty.optional(),
  attempt: z.number().int().min(1).optional(),
  retry_of: nonEmpty.optional(),
})

export const approvalRequestSchema = envelopeSchema.extend({
  type: z.literal('approval.request'),
  approval_id: nonEmpty,
  action: nonEmpty,
  summary: z.string(),
  call_id: nonEmpty.optional(),
  policy: z.string().optional(),
})

export const approvalDecisionSchema = envelopeSchema.extend({
  type: z.literal('approval.decision'),
  approval_id: nonEmpty,
  decision: z.enum(['approved', 'rejected']),
  by: z.looseObject({ kind: z.enum(['human', 'policy']), name: z.string().optional() }),
  reason: z.string().optional(),
})

export const errorEventSchema = envelopeSchema.extend({
  type: z.literal('error'),
  error: errorInfoSchema,
})

export const logEventSchema = envelopeSchema.extend({
  type: z.literal('log'),
  level: z.enum(['debug', 'info', 'warn']).optional(),
  message: z.string(),
})

export const knownEventSchema = z.discriminatedUnion('type', [
  runStartSchema,
  runEndSchema,
  modelCallSchema,
  toolCallSchema,
  modelStartSchema,
  toolStartSchema,
  approvalRequestSchema,
  approvalDecisionSchema,
  errorEventSchema,
  logEventSchema,
])

export const KNOWN_EVENT_TYPES = [
  'run.start',
  'run.end',
  'model.call',
  'tool.call',
  'model.start',
  'tool.start',
  'approval.request',
  'approval.decision',
  'error',
  'log',
] as const

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number]
export type ErrorInfo = z.infer<typeof errorInfoSchema>
export type Envelope = z.infer<typeof envelopeSchema>
export type RunStartEvent = z.infer<typeof runStartSchema>
export type RunEndEvent = z.infer<typeof runEndSchema>
export type ModelCallEvent = z.infer<typeof modelCallSchema>
export type ToolCallEvent = z.infer<typeof toolCallSchema>
export type ModelStartEvent = z.infer<typeof modelStartSchema>
export type ToolStartEvent = z.infer<typeof toolStartSchema>
export type ApprovalRequestEvent = z.infer<typeof approvalRequestSchema>
export type ApprovalDecisionEvent = z.infer<typeof approvalDecisionSchema>
export type ErrorEvent = z.infer<typeof errorEventSchema>
export type LogEvent = z.infer<typeof logEventSchema>
export type KnownEvent = z.infer<typeof knownEventSchema>

export function isKnownEventType(type: string): type is KnownEventType {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(type)
}
