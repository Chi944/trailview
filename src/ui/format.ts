export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    const factor = totalSeconds < 10 ? 100 : 10
    return `${Math.round(totalSeconds * factor) / factor} s`
  }
  const rounded = Math.round(totalSeconds)
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  if (minutes < 60) return `${minutes} min ${seconds} s`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes - hours * 60} min`
}

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}
