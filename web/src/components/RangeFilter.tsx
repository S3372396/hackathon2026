import { PRESETS } from '../lib/useDateRange.ts'
import type { DayRange, Preset } from '../lib/useDateRange.ts'

// Presets first, then exact dates.
export default function RangeFilter({
  preset,
  range,
  onPreset,
  onRange,
}: {
  preset: Preset
  range: DayRange
  onPreset: (preset: Preset) => void
  onRange: (range: DayRange) => void
}) {
  return (
    <>
      <div className="seg-group" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="seg" aria-pressed={preset === p.id} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="inline-field">
        From
        <input
          type="date"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => onRange({ from: e.target.value, to: range.to })}
        />
      </label>
      <label className="inline-field">
        To
        <input
          type="date"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => onRange({ from: range.from, to: e.target.value })}
        />
      </label>
    </>
  )
}
