// Links to a place in a log. The log itself never goes in the link: a link
// names a bundled sample, or the file name the reader should open, plus the
// run and event to jump to. Everything lives in the URL hash, so nothing is
// sent to a server even when the demo is hosted.
export interface LinkTarget {
  sample?: string
  file?: string
  run?: string
  event?: string
}

export function parseLink(hash: string): LinkTarget | undefined {
  const params = new URLSearchParams(hash.replace(/^#\/?\??/, ''))
  const target: LinkTarget = {}
  for (const key of ['sample', 'file', 'run', 'event'] as const) {
    const value = params.get(key)
    if (value) target[key] = value
  }
  return Object.keys(target).length ? target : undefined
}

export function linkHash(target: LinkTarget): string {
  const params = new URLSearchParams()
  for (const key of ['sample', 'file', 'run', 'event'] as const) {
    const value = target[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `#${query}` : ''
}
