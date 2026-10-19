import type { ParseIssue } from '../../core/parse/jsonl.ts'

export function IssuesPanel({ issues }: { issues: ParseIssue[] }) {
  if (issues.length === 0) return null
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  const parts = [errors && `${errors} skipped line${errors === 1 ? '' : 's'}`, warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`]
  return (
    <details className="issues">
      <summary>{parts.filter(Boolean).join(', ')}</summary>
      <ul>
        {issues.map((issue, i) => (
          <li key={i} className={`issue issue--${issue.severity}`}>
            <span className="issue__line">Line {issue.line}</span> {issue.message}
          </li>
        ))}
      </ul>
    </details>
  )
}
