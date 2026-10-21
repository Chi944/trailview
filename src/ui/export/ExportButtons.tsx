import { useState } from 'react'

interface Props {
  // Built on click, so the export always matches the filters on screen.
  markdown: () => string
  fileName: string
}

export function ExportButtons({ markdown, fileName }: Props) {
  const [done, setDone] = useState<string>()
  const copy = () =>
    navigator.clipboard.writeText(markdown()).then(
      () => setDone('Copied as Markdown'),
      () => setDone('Could not copy; use Download .md'),
    )
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    setDone(`Saved ${fileName}`)
  }
  return (
    <span className="export">
      <button type="button" className="button" onClick={() => void copy()} title="Copy the run summary and the events shown as a Markdown table">
        Copy as Markdown
      </button>
      <button type="button" className="button" onClick={download}>
        Download .md
      </button>
      <span role="status" className="muted">
        {done}
      </span>
    </span>
  )
}
