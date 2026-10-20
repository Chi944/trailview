import type { ReactNode } from 'react'
import type { ErrorInfo } from '../../core/schema/events.ts'
import { JsonView } from './JsonView.tsx'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail__section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

export function Fields({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (shown.length === 0) return null
  return (
    <dl className="fields">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ErrorBox({ error }: { error: ErrorInfo }) {
  return (
    <div className="error-box" role="note">
      <strong>{error.type}</strong>
      {error.code !== undefined && <span className="muted"> ({error.code})</span>}: {error.message}
      {error.retryable !== undefined && <div className="muted">{error.retryable ? 'Retryable' : 'Not retryable'}</div>}
    </div>
  )
}

// Text stays readable as text; anything else goes in the JSON tree.
export function Payload({ value }: { value: unknown }) {
  if (value === undefined) return <p className="muted">Not logged.</p>
  if (typeof value === 'string') return <pre className="text-block">{value}</pre>
  if (isTruncated(value)) {
    return (
      <div>
        <p className="muted">Truncated in the log ({value.bytes.toLocaleString('en-US')} bytes). Preview:</p>
        <pre className="text-block">{value.preview}</pre>
      </div>
    )
  }
  return <JsonView value={value} />
}

function isTruncated(v: unknown): v is { truncated: true; bytes: number; preview: string } {
  const o = v as Record<string, unknown>
  return typeof v === 'object' && v !== null && o.truncated === true && typeof o.bytes === 'number' && typeof o.preview === 'string'
}
