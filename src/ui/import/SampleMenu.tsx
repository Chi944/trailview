import { SAMPLES } from './samples.ts'

export function SampleMenu({ onPick }: { onPick: (name: string, text: string) => void }) {
  return (
    <section className="samples" aria-labelledby="samples-heading">
      <h2 id="samples-heading">Or try a sample run</h2>
      <ul>
        {SAMPLES.map((s) => (
          <li key={s.file}>
            <button type="button" className="button button--link" onClick={() => void s.load().then((text) => onPick(s.file, text))}>
              {s.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
