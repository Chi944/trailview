import type { ParsedEvent } from './parse/jsonl.ts'
import type { TimelineItem } from './derive/retries.ts'

// A search box query: words and "quoted phrases", all of which must appear
// somewhere in an item, plus field:value terms that look at one top-level
// field. Matching ignores case and looks at values only, not field names.
export interface SearchTerm {
  field?: string
  text: string
}

// Field names a term can be scoped to. Anything else with a colon, such as a
// URL, is searched as plain text.
export const SEARCH_FIELDS = ['type', 'model', 'provider', 'tool', 'agent', 'status', 'step', 'id', 'level', 'action'] as const

const FIELD_SET = new Set<string>(SEARCH_FIELDS)
const TOKEN = /(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi

export function parseQuery(input: string): SearchTerm[] {
  const terms: SearchTerm[] = []
  for (const m of input.matchAll(TOKEN)) {
    const field = m[1]?.toLowerCase()
    const value = m[2] ?? m[3] ?? ''
    if (field && FIELD_SET.has(field)) {
      if (value.trim()) terms.push({ field, text: flatten(value).toLowerCase() })
    } else {
      const text = flatten((m[1] ? `${m[1]}:` : '') + value)
      if (text) terms.push({ text: text.toLowerCase() })
    }
  }
  return terms
}

// A string value in an event and where it sits, e.g. `output.text` or
// `input.messages[2].content`.
interface Leaf {
  path: string
  raw: string
  lower: string
}

// Each event's leaves, plus all their text in one string so a plain term can
// rule an event out with one includes() instead of one per value.
const leafCache = new WeakMap<object, { leaves: Leaf[]; all: string }>()

function indexOf(event: object): { leaves: Leaf[]; all: string } {
  let index = leafCache.get(event)
  if (!index) {
    const leaves: Leaf[] = []
    collect(event, '', leaves)
    // A separator no query can contain, so a term never matches across two values.
    index = { leaves, all: leaves.map((l) => l.lower).join('\u0000') }
    leafCache.set(event, index)
  }
  return index
}

function collect(value: unknown, path: string, out: Leaf[]): void {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const raw = String(value)
    out.push({ path, raw, lower: flatten(raw).toLowerCase() })
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, `${path}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, path ? `${path}.${k}` : k, out)
  }
}

function inField(leaf: Leaf, field: string): boolean {
  return leaf.path === field || leaf.path.startsWith(`${field}.`) || leaf.path.startsWith(`${field}[`)
}

function termHit(event: ParsedEvent['event'], term: SearchTerm): Leaf | undefined {
  const { leaves, all } = indexOf(event)
  if (!term.field) return all.includes(term.text) ? leaves.find((l) => l.lower.includes(term.text)) : undefined
  const value = (event as Record<string, unknown>)[term.field]
  // Numbers such as step are compared whole, so step:3 does not match step 13.
  if (typeof value === 'number') return String(value) === term.text ? leaves.find((l) => l.path === term.field) : undefined
  return leaves.find((l) => inField(l, term.field!) && l.lower.includes(term.text))
}

export function itemMatches(item: TimelineItem, terms: SearchTerm[]): boolean {
  return terms.every((term) => item.events.some((e) => termHit(e.event, term)))
}

// Where the first term matched in an item, cut to a short window around the
// match, so a row can show why it is in the results.
export interface SearchHit {
  path: string
  before: string
  match: string
  after: string
}

export function firstHit(item: TimelineItem, terms: SearchTerm[], context = 40): SearchHit | undefined {
  // Prefer a plain term: a field term's value is usually already on the row.
  const ordered = [...terms.filter((t) => !t.field), ...terms.filter((t) => t.field)]
  for (const term of ordered) {
    for (const e of [...item.events].reverse()) {
      const leaf = termHit(e.event, term)
      if (!leaf) continue
      const flat = flatten(leaf.raw)
      const at = flat.toLowerCase().indexOf(term.text)
      // Lower-casing can change the length of some characters; then show the value without a mark.
      if (at < 0 || flat.length !== flat.toLowerCase().length) return { path: leaf.path, before: clip(flat, context * 2), match: '', after: '' }
      const start = Math.max(0, at - context)
      const end = Math.min(flat.length, at + term.text.length + context)
      return {
        path: leaf.path,
        before: (start > 0 ? '…' : '') + flat.slice(start, at),
        match: flat.slice(at, at + term.text.length),
        after: flat.slice(at + term.text.length, end) + (end < flat.length ? '…' : ''),
      }
    }
  }
  return undefined
}

// Runs of whitespace count as one space, so a phrase matches across line breaks.
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
