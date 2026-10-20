import { useEffect, useRef } from 'react'

export const SHORTCUTS: [string, string][] = [
  ['↑ ↓ or j k', 'Move through events'],
  ['Page Up / Page Down', 'Move ten events'],
  ['Home / End', 'First or last event'],
  ['Enter', 'Open the selected event'],
  ['← →', 'Collapse or expand the current step'],
  ['Esc', 'Close the detail panel or this list'],
  ['/', 'Search events'],
  ['e', 'Toggle errors only'],
  ['t', 'Focus the timeline'],
  ['?', 'Show these shortcuts'],
]

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <button ref={close} type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
