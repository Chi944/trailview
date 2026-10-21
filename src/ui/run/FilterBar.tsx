import type { ReactNode } from 'react'
import type { Run } from '../../core/model/run.ts'
import { CATEGORIES, CATEGORY_LABELS, categoryOf, type Category, type Filters } from '../../core/filter.ts'

interface Props {
  run: Run
  filters: Filters
  shown: number
  onToggle: (category: Category) => void
  onErrorsOnly: (value: boolean) => void
  onText: (text: string) => void
  onClear: () => void
  // Actions on the filtered view, shown at the end of the bar.
  children?: ReactNode
}

export const SEARCH_INPUT_ID = 'timeline-search'

export function FilterBar({ run, filters, shown, onToggle, onErrorsOnly, onText, onClear, children }: Props) {
  const counts = new Map<Category, number>()
  for (const item of run.items) {
    const c = categoryOf(item.events[0]!)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const active = filters.hidden.length > 0 || filters.errorsOnly || filters.text !== ''

  return (
    <div className="filters" role="search">
      <div className="filters__chips" role="group" aria-label="Event types">
        {CATEGORIES.filter((c) => counts.has(c)).map((c) => (
          <button
            key={c}
            type="button"
            className="chip"
            aria-pressed={!filters.hidden.includes(c)}
            onClick={() => onToggle(c)}
          >
            <span className={`chip__dot kind--${c}`} aria-hidden="true" />
            {CATEGORY_LABELS[c]} <span className="muted">{counts.get(c)}</span>
          </button>
        ))}
      </div>
      <label className="filters__check">
        <input type="checkbox" checked={filters.errorsOnly} onChange={(e) => onErrorsOnly(e.target.checked)} /> Errors only
      </label>
      <input
        id={SEARCH_INPUT_ID}
        type="search"
        className="filters__search"
        placeholder="Search events  /"
        aria-label="Search events"
        value={filters.text}
        onChange={(e) => onText(e.target.value)}
      />
      <span className="muted filters__count" aria-live="polite">
        {shown} of {run.items.length} shown
      </span>
      {active && (
        <button type="button" className="button button--link" onClick={onClear}>
          Clear filters
        </button>
      )}
      {children}
    </div>
  )
}
