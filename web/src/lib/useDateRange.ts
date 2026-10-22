import { useState } from 'react'
import type { Entry } from '@contract'
import { addDays, dateKey, isDayKey, todayKey } from './dates.ts'

export type Preset = '7' | '14' | 'all' | 'custom'

export const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: '7', label: 'Last 7 days' },
  { id: '14', label: 'Last 14 days' },
  { id: 'all', label: 'All time' },
]

export interface DayRange {
  from: string
  to: string
}

function presetRange(preset: Exclude<Preset, 'custom'>, entries: Entry[]): DayRange {
  const today = todayKey()
  if (preset === '7') return { from: addDays(today, -6), to: today }
  if (preset === '14') return { from: addDays(today, -13), to: today }
  const days = entries.map((e) => dateKey(e.loggedAt)).sort()
  const latest = days[days.length - 1]
  return { from: days[0] ?? today, to: latest && latest > today ? latest : today }
}

// A date range chosen from presets or typed in. "All time" follows the entries given.
export function useDateRange(entries: Entry[], initial: Exclude<Preset, 'custom'>) {
  const [preset, setPreset] = useState<Preset>(initial)
  const [custom, setCustom] = useState<DayRange>(() => presetRange(initial, []))

  const range = preset === 'custom' ? custom : presetRange(preset, entries)
  const valid = isDayKey(range.from) && isDayKey(range.to) && range.from <= range.to

  return {
    preset,
    range,
    valid,
    choosePreset: setPreset,
    setRange: (next: DayRange) => {
      setCustom(next)
      setPreset('custom')
    },
  }
}
