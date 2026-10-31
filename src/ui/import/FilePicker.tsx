import { useRef, useState, type DragEvent } from 'react'

interface Props {
  onFile: (file: File) => void
  label?: string
  disabled?: boolean
}

// Picks a local file. It is read in this tab, off the main thread, and never uploaded anywhere.
export function FilePicker({ onFile, label = 'Open a log file', disabled = false }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function read(file: File | undefined) {
    if (file) onFile(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    read(e.dataTransfer.files[0])
  }

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <button type="button" className="button button--primary" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <span className="muted">or drop one here</span>
      <input
        ref={input}
        type="file"
        accept=".jsonl,.ndjson,.json,.txt,application/x-ndjson"
        hidden
        data-testid="file-input"
        onChange={(e) => {
          read(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
