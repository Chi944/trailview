import type { Run } from '../../core/model/run.ts'
import type { Approval } from '../../core/derive/approvals.ts'
import { callCost, computeTotals } from '../../core/derive/totals.ts'
import { descendantsOf } from '../../core/derive/nesting.ts'
import type { TimelineItem } from '../../core/derive/retries.ts'
import type { AgentCallEvent, ErrorEvent, LogEvent, ModelCallEvent, RunEndEvent, RunStartEvent, ToolCallEvent } from '../../core/schema/events.ts'
import { formatDuration, formatTokens, formatUsd } from '../format.ts'
import { JsonView } from './JsonView.tsx'
import { ErrorBox, Fields, Payload, Section } from './parts.tsx'

export function ModelCallDetail({ event, run }: { event: ModelCallEvent; run: Run }) {
  const cost = callCost(event, run.pricing)
  const usage = event.usage
  return (
    <>
      <Fields
        rows={[
          ['Provider', event.provider],
          ['Model', event.model],
          ['Status', event.unfinished ? 'unfinished' : event.status],
          ['Stop reason', event.stop_reason],
          ['Duration', event.unfinished ? `at least ${formatDuration(event.duration_ms)}` : formatDuration(event.duration_ms)],
          ['Tokens in', usage && formatTokens(usage.input_tokens)],
          ['Tokens out', usage && formatTokens(usage.output_tokens)],
          ['Cache read', usage?.cache_read_tokens !== undefined ? formatTokens(usage.cache_read_tokens) : undefined],
          ['Cache write', usage?.cache_write_tokens !== undefined ? formatTokens(usage.cache_write_tokens) : undefined],
          ['Cost', cost ? `${formatUsd(cost.usd)}${cost.estimated ? ' est.' : ''}` : usage ? 'No price for this model' : undefined],
        ]}
      />
      {event.error && <ErrorBox error={event.error} />}
      {event.output?.text && (
        <Section title="Output">
          <pre className="text-block">{event.output.text}</pre>
        </Section>
      )}
      {event.output?.tool_calls?.length ? (
        <Section title="Tool calls requested">
          {event.output.tool_calls.map((call) => (
            <div key={call.id} className="tool-request">
              <div>
                <strong>{call.name}</strong> <span className="muted mono">{call.id}</span>
              </div>
              <JsonView value={call.input} />
            </div>
          ))}
        </Section>
      ) : null}
      <Section title="Input">
        <Messages value={event.input} />
      </Section>
    </>
  )
}

function Messages({ value }: { value: unknown }) {
  const isMessageList =
    Array.isArray(value) && value.every((m) => typeof m === 'object' && m !== null && typeof (m as { role?: unknown }).role === 'string')
  if (!isMessageList) return <Payload value={value} />
  return (
    <ol className="messages">
      {(value as { role: string; content?: unknown }[]).map((m, i) => (
        <li key={i}>
          <div className="messages__role">{m.role}</div>
          <Payload value={m.content} />
        </li>
      ))}
    </ol>
  )
}

export function ToolCallDetail({ event, approval }: { event: ToolCallEvent; approval?: Approval }) {
  return (
    <>
      <Fields
        rows={[
          ['Tool', event.tool],
          ['Call id', event.call_id && <span className="mono">{event.call_id}</span>],
          ['Status', event.unfinished ? 'unfinished' : event.status],
          ['Duration', event.unfinished ? `at least ${formatDuration(event.duration_ms)}` : formatDuration(event.duration_ms)],
          ['Approval', approval && `${approval.outcome}${approval.decision?.by.name ? ` by ${approval.decision.by.name}` : ''}`],
        ]}
      />
      {event.error && <ErrorBox error={event.error} />}
      <Section title="Input">
        <Payload value={event.input} />
      </Section>
      <Section title="Output">
        <Payload value={event.output} />
      </Section>
    </>
  )
}

export function ApprovalDetail({ approval }: { approval: Approval }) {
  const { request, decision, toolCall } = approval
  return (
    <>
      <Fields
        rows={[
          ['Outcome', <span className={`badge badge--${approval.outcome}`}>{approval.outcome}</span>],
          ['Action', request?.action],
          ['Summary', request?.summary],
          ['Policy', request?.policy],
          ['Decided by', decision && `${decision.by.name ?? 'unnamed'} (${decision.by.kind})`],
          ['Reason', decision?.reason],
          ['Waited', approval.waitMs !== undefined ? formatDuration(approval.waitMs) : undefined],
          ['Gated call', request?.call_id && <span className="mono">{request.call_id}</span>],
          ['Tool run', toolCall ? `${toolCall.tool} (${toolCall.status})` : approval.outcome === 'rejected' ? 'Not run' : undefined],
        ]}
      />
      {!decision && <p className="muted">No decision was logged for this request.</p>}
    </>
  )
}

export function RunStartDetail({ event }: { event: RunStartEvent }) {
  return (
    <>
      <Fields rows={[['Agent', event.agent.name], ['Version', event.agent.version], ['Schema version', String(event.v)]]} />
      <Section title="Input">
        <Payload value={event.input} />
      </Section>
      {event.pricing && (
        <Section title="Price overrides">
          <JsonView value={event.pricing} />
        </Section>
      )}
    </>
  )
}

export function RunEndDetail({ event }: { event: RunEndEvent }) {
  return (
    <>
      <Fields rows={[['Status', event.status]]} />
      {event.error && <ErrorBox error={event.error} />}
      <Section title="Output">
        <Payload value={event.output} />
      </Section>
    </>
  )
}

export function ErrorDetail({ event }: { event: ErrorEvent }) {
  return <ErrorBox error={event.error} />
}

export function LogDetail({ event }: { event: LogEvent }) {
  return (
    <>
      <Fields rows={[['Level', event.level]]} />
      <pre className="text-block">{event.message}</pre>
    </>
  )
}

export function AgentCallDetail({ event }: { event: AgentCallEvent }) {
  return (
    <>
      <Fields
        rows={[
          ['Sub-agent', event.agent.name],
          ['Version', event.agent.version],
          ['Status', event.status],
          ['Duration', formatDuration(event.duration_ms)],
        ]}
      />
      {event.error && <ErrorBox error={event.error} />}
      <Section title="Input">
        <Payload value={event.input} />
      </Section>
      <Section title="Output">
        <Payload value={event.output} />
      </Section>
    </>
  )
}

// What the events nested under a row (a sub-agent's work) added up to.
export function NestedSummary({ run, item }: { run: Run; item: TimelineItem }) {
  const nested = descendantsOf(run.items, item.id)
  const events = nested.flatMap((i) => i.events)
  const ids = new Set(events.map((e) => e.event.id))
  const approvals = run.approvals.filter((a) => (a.request && ids.has(a.request.id)) || (a.decision && ids.has(a.decision.id)))
  const totals = computeTotals(events, approvals, 0, run.pricing)
  return (
    <Section title={`Nested events (${nested.length})`}>
      <Fields
        rows={[
          ['Model calls', String(totals.modelCalls)],
          ['Tool calls', String(totals.toolCalls)],
          ['Tokens', `${formatTokens(totals.inputTokens)} in / ${formatTokens(totals.outputTokens)} out`],
          ['Cost', `${formatUsd(totals.costUsd)}${totals.costEstimated ? ' est.' : ''}`],
          ['Errors', totals.errors ? String(totals.errors) : undefined],
          ['Approvals', totals.approvals ? String(totals.approvals) : undefined],
        ]}
      />
    </Section>
  )
}
