import { useEffect, useRef, useState } from 'react'
import type { Run } from '../../core/model/run.ts'
import type { TimelineItem } from '../../core/derive/retries.ts'
import type { ParsedEvent } from '../../core/parse/jsonl.ts'
import { isErrorEvent } from '../../core/filter.ts'
import { isUnfinished } from '../../core/derive/starts.ts'
import { formatDuration } from '../format.ts'
import { describeEvent } from '../timeline/describe.ts'
import { JsonView } from './JsonView.tsx'
import { Fields, Section } from './parts.tsx'
import {
  AgentCallDetail,
  ApprovalDetail,
  ErrorDetail,
  LogDetail,
  ModelCallDetail,
  NestedSummary,
  RunEndDetail,
  RunStartDetail,
  ToolCallDetail,
} from './renderers.tsx'

interface Props {
  run: Run
  item: TimelineItem
  onClose: () => void
}

export function DetailPanel({ run, item, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const final = item.events[item.events.length - 1]!
  const { label } = describeEvent(final)
  const event = final.event

  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'nearest' })
  }, [item.id])

  const attrs = event.attrs as Record<string, unknown> | undefined
  return (
    <aside className="detail" aria-labelledby="detail-title">
      <header className="detail__header">
        <div>
          <div className="muted detail__type">{isUnfinished(final) ? `${final.kind === 'known' && final.source?.type} · unfinished` : event.type}</div>
          <h2 id="detail-title" ref={heading}>
            {label}
          </h2>
        </div>
        <div className="detail__actions">
          <CopyLink key={item.id} />
          <button type="button" className="button" onClick={onClose} aria-label="Close details (Esc)">
            ✕
          </button>
        </div>
      </header>
      <Fields
        rows={[
          ['Started', `+${formatDuration(Date.parse(item.events[0]!.event.ts) - run.startMs)} (${item.events[0]!.event.ts})`],
          ['Step', typeof event.step === 'number' ? String(event.step) : undefined],
          ['Event id', <span className="mono">{event.id}</span>],
        ]}
      />
      {item.events.length > 1 && <Attempts events={item.events} />}
      <Body parsed={final} run={run} />
      {item.descendants ? <NestedSummary run={run} item={item} /> : null}
      {attrs && Object.keys(attrs).length > 0 && (
        <Section title="Attributes">
          <Fields rows={Object.entries(attrs).map(([k, v]) => [k, typeof v === 'object' ? <JsonView value={v} /> : String(v)])} />
        </Section>
      )}
      <Section title={item.events.length > 1 ? 'Raw events' : 'Raw event'}>
        {item.events.map((e) => (
          <div key={e.event.id}>
            <div className="muted mono">line {e.line}</div>
            <JsonView value={(e.kind === 'known' && e.source) || e.event} openDepth={1} />
          </div>
        ))}
      </Section>
    </aside>
  )
}

// The address bar already links to the open event, so copying it is enough.
// Keyed by the event, so the feedback resets when another event opens.
function CopyLink() {
  const [copied, setCopied] = useState<'copied' | 'failed'>()
  const copy = () =>
    navigator.clipboard.writeText(location.href).then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    )
  return (
    <>
      <button type="button" className="button" onClick={() => void copy()}>
        Copy link
      </button>
      <span role="status" className="muted">
        {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy the address bar instead' : ''}
      </span>
    </>
  )
}

function Attempts({ events }: { events: ParsedEvent[] }) {
  return (
    <Section title={`${events.length} attempts`}>
      <ol className="attempts">
        {events.map((e) => {
          const ev = e.event
          const failed = isErrorEvent(e)
          const error = ev.error as { message?: string } | undefined
          return (
            <li key={ev.id} className={failed ? 'attempts__failed' : 'attempts__ok'}>
              <span className="mono">{ev.id}</span> · {failed ? 'failed' : 'ok'}
              {typeof ev.duration_ms === 'number' && ` · ${formatDuration(ev.duration_ms)}`}
              {failed && error?.message && <div className="muted">{error.message}</div>}
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

function Body({ parsed, run }: { parsed: ParsedEvent; run: Run }) {
  if (parsed.kind === 'unknown') {
    return <p className="muted">This event type is not part of the Trailview format. Its raw content is below.</p>
  }
  const event = parsed.event
  switch (event.type) {
    case 'model.call':
      return <ModelCallDetail event={event} run={run} />
    case 'tool.call':
      return <ToolCallDetail event={event} approval={run.approvals.find((a) => a.approvalId === event.approval_id)} />
    case 'approval.request':
    case 'approval.decision': {
      const approval = run.approvals.find((a) => a.approvalId === event.approval_id)
      return approval ? <ApprovalDetail approval={approval} /> : null
    }
    case 'agent.call':
      return <AgentCallDetail event={event} />
    case 'run.start':
      return <RunStartDetail event={event} />
    case 'run.end':
      return <RunEndDetail event={event} />
    case 'error':
      return <ErrorDetail event={event} />
    case 'log':
      return <LogDetail event={event} />
  }
}
