import type { Entry } from '@contract'
import { dateKey, formatShortDay } from './dates.ts'

export type EntryType = Entry['type']

// Display order everywhere: mood first, then symptoms, then habits.
export const ENTRY_TYPES: EntryType[] = ['mood', 'symptom', 'habit']

export const TYPE_LABEL: Record<EntryType, string> = {
  habit: 'Habit',
  mood: 'Mood',
  symptom: 'Symptom',
}

export const TYPE_PLURAL: Record<EntryType, string> = {
  habit: 'Habits',
  mood: 'Moods',
  symptom: 'Symptoms',
}

export interface ValueRule {
  label: string
  hint: string
  min?: number
  max?: number
  step: number | 'any'
  required: boolean
}

// What `value` means for each type. The contract only says number | string.
export const VALUE_RULES: Record<EntryType, ValueRule> = {
  mood: { label: 'Mood', hint: '1 is very low, 5 is very good', min: 1, max: 5, step: 1, required: true },
  symptom: { label: 'Severity', hint: '0 is none, 10 is the worst', min: 0, max: 10, step: 1, required: true },
  habit: { label: 'Amount', hint: 'Optional, for example minutes or glasses', min: 0, step: 'any', required: false },
}

export function numericValue(entry: Entry): number | null {
  const { value } = entry
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function formatValue(entry: Entry): string {
  const n = numericValue(entry)
  if (n === null) return typeof entry.value === 'string' ? entry.value : ''
  if (entry.type === 'mood') return `${n} / 5`
  if (entry.type === 'symptom') return `${n} / 10`
  return String(n)
}

export interface EntryFilter {
  type: EntryType | 'all'
  from: string // day key, inclusive
  to: string // day key, inclusive
}

export function filterEntries(entries: Entry[], { type, from, to }: EntryFilter): Entry[] {
  return entries.filter((e) => {
    if (type !== 'all' && e.type !== type) return false
    const day = dateKey(e.loggedAt)
    return day >= from && day <= to
  })
}

export interface DayGroup {
  day: string
  entries: Entry[]
}

// Newest day first; within a day, in the order they were logged.
export function groupByDay(entries: Entry[]): DayGroup[] {
  const groups = new Map<string, Entry[]>()
  for (const entry of [...entries].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))) {
    const day = dateKey(entry.loggedAt)
    groups.set(day, [...(groups.get(day) ?? []), entry])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayEntries]) => ({ day, entries: dayEntries }))
}

export interface SeriesPoint {
  day: string
  value: number // mean of that day's values when logged more than once
  count: number
}

export interface Series {
  key: string
  type: EntryType
  title: string
  points: SeriesPoint[] // oldest first
  latest: number
  average: number
  entryCount: number
}

// One series per (type, title) that has numeric values, ready to chart.
// Order: type order, then most-logged first, then title.
export function buildSeries(entries: Entry[]): Series[] {
  const groups = new Map<string, { type: EntryType; title: string; entries: Entry[] }>()
  for (const entry of [...entries].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))) {
    if (numericValue(entry) === null) continue
    const key = `${entry.type}:${entry.title.trim().toLowerCase()}`
    const group = groups.get(key) ?? { type: entry.type, title: entry.title.trim(), entries: [] }
    group.title = entry.title.trim() // latest spelling wins
    group.entries.push(entry)
    groups.set(key, group)
  }

  const series: Series[] = []
  for (const [key, group] of groups) {
    const byDay = new Map<string, number[]>()
    for (const entry of group.entries) {
      const day = dateKey(entry.loggedAt)
      byDay.set(day, [...(byDay.get(day) ?? []), numericValue(entry) as number])
    }
    const points = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, values]) => ({
        day,
        value: values.reduce((sum, v) => sum + v, 0) / values.length,
        count: values.length,
      }))
    const all = group.entries.map((e) => numericValue(e) as number)
    series.push({
      key,
      type: group.type,
      title: group.title,
      points,
      latest: all[all.length - 1],
      average: all.reduce((sum, v) => sum + v, 0) / all.length,
      entryCount: all.length,
    })
  }

  return series.sort(
    (a, b) =>
      ENTRY_TYPES.indexOf(a.type) - ENTRY_TYPES.indexOf(b.type) ||
      b.entryCount - a.entryCount ||
      a.title.localeCompare(b.title),
  )
}

// Round to at most one decimal for display ("3.4", not "3.4285714").
export function formatNumber(n: number): string {
  return String(Math.round(n * 10) / 10)
}

export interface EntrySummary {
  count: number
  types: EntryType[]
  from?: string // day key of the earliest entry
  to?: string // day key of the latest entry
}

export function summarizeEntries(entries: Entry[]): EntrySummary {
  const days = entries.map((e) => dateKey(e.loggedAt)).sort()
  return {
    count: entries.length,
    types: ENTRY_TYPES.filter((t) => entries.some((e) => e.type === t)),
    from: days[0],
    to: days[days.length - 1],
  }
}

// "7 entries · Symptoms · 17 Oct to 23 Oct", for share summaries and the audit trail.
export function describeEntries(summary: EntrySummary): string {
  const parts = [`${summary.count} ${summary.count === 1 ? 'entry' : 'entries'}`]
  if (summary.types.length > 0) parts.push(summary.types.map((t) => TYPE_PLURAL[t]).join(', '))
  if (summary.from && summary.to) {
    parts.push(summary.from === summary.to ? formatShortDay(summary.from) : `${formatShortDay(summary.from)} to ${formatShortDay(summary.to)}`)
  }
  return parts.join(' · ')
}
