import { TYPE_LABEL } from '../lib/entries.ts'
import type { EntryType } from '../lib/entries.ts'

// The coloured dot is a secondary cue; the text label always carries the meaning.
export default function TypeBadge({ type }: { type: EntryType }) {
  return (
    <span className="badge">
      <span className={`dot dot-${type}`} aria-hidden="true" />
      {TYPE_LABEL[type]}
    </span>
  )
}
