import { useRef, useState, type DragEvent } from 'react'

interface Props {
  onText: (name: string, text: string) => void
  onError: (message: string) => void
}

// Reads a local file in the browser. Nothing is uploaded anywhere.
export function FilePicker({ onText, onError }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  async function read(file: File | undefined) {
    if (!file) return
    try {
      onText(file.name, await file.text())
    } catch (err) {
      onError(`Could not read ${file.name}: ${(err as Error).message}`)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void read(e.dataTransfer.files[0])
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
      <button type="button" className="button button--primary" onClick={() => input.current?.click()}>
        Open a log file
      </button>
      <span className="muted">or drop one here</span>
      <input
        ref={input}
        type="file"
        accept=".jsonl,.ndjson,.json,.txt,application/x-ndjson"
        hidden
        data-testid="file-input"
        onChange={(e) => {
          void read(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
