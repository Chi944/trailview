// Collapsible JSON tree. Objects and arrays below `openDepth` start expanded.
export function JsonView({ value, openDepth = 2 }: { value: unknown; openDepth?: number }) {
  return (
    <div className="json">
      <Node value={value} depth={0} openDepth={openDepth} />
    </div>
  )
}

function Node({ value, depth, openDepth, name }: { value: unknown; depth: number; openDepth: number; name?: string }) {
  const label = name !== undefined ? <span className="json__key">{name}: </span> : null
  if (value === null || typeof value !== 'object') {
    return (
      <div className="json__leaf">
        {label}
        <Scalar value={value} />
      </div>
    )
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const brackets = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  if (entries.length === 0) {
    return (
      <div className="json__leaf">
        {label}
        <span className="json__punct">{brackets.join('')}</span>
      </div>
    )
  }
  return (
    <details className="json__node" open={depth < openDepth}>
      <summary>
        {label}
        <span className="json__punct">{brackets[0]}</span>
        <span className="json__count"> {entries.length} {Array.isArray(value) ? 'items' : 'keys'} </span>
        <span className="json__punct">{brackets[1]}</span>
      </summary>
      <div className="json__children">
        {entries.map(([k, v]) => (
          <Node key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} />
        ))}
      </div>
    </details>
  )
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="json__string">{JSON.stringify(value)}</span>
  if (typeof value === 'number') return <span className="json__number">{value}</span>
  if (typeof value === 'boolean') return <span className="json__bool">{String(value)}</span>
  return <span className="json__null">null</span>
}
