import { describe, expect, it } from 'vitest'
import type { Entry } from '@contract'
import { dateKey } from './dates.ts'
import { buildSeries, describeEntries, filterEntries, formatValue, groupByDay, numericValue, summarizeEntries } from './entries.ts'

let n = 0
function entry(partial: Partial<Entry> & Pick<Entry, 'type' | 'title'>, day = '2026-03-10', hour = 9): Entry {
  const [y, m, d] = day.split('-').map(Number)
  return {
    id: `e-${++n}`,
    patientId: 'p',
    loggedAt: new Date(y, m - 1, d, hour).toISOString(),
    ...partial,
  }
}

describe('numericValue / formatValue', () => {
  it('reads numbers and numeric strings, ignores the rest', () => {
    expect(numericValue(entry({ type: 'mood', title: 'm', value: 4 }))).toBe(4)
    expect(numericValue(entry({ type: 'habit', title: 'h', value: '25' }))).toBe(25)
    expect(numericValue(entry({ type: 'habit', title: 'h', value: 'a lot' }))).toBeNull()
    expect(numericValue(entry({ type: 'habit', title: 'h' }))).toBeNull()
    expect(numericValue(entry({ type: 'habit', title: 'h', value: '' }))).toBeNull()
  })

  it('shows the scale for mood and symptoms', () => {
    expect(formatValue(entry({ type: 'mood', title: 'm', value: 4 }))).toBe('4 / 5')
    expect(formatValue(entry({ type: 'symptom', title: 's', value: 7 }))).toBe('7 / 10')
    expect(formatValue(entry({ type: 'habit', title: 'h', value: 20 }))).toBe('20')
    expect(formatValue(entry({ type: 'habit', title: 'h', value: 'a lot' }))).toBe('a lot')
    expect(formatValue(entry({ type: 'habit', title: 'h' }))).toBe('')
  })
})

describe('filterEntries', () => {
  const entries = [
    entry({ type: 'mood', title: 'Mood' }, '2026-03-08'),
    entry({ type: 'symptom', title: 'Ache' }, '2026-03-09'),
    entry({ type: 'symptom', title: 'Ache' }, '2026-03-10', 23),
    entry({ type: 'habit', title: 'Walk' }, '2026-03-11'),
  ]

  it('filters by type and keeps both ends of the date range', () => {
    const result = filterEntries(entries, { type: 'symptom', from: '2026-03-09', to: '2026-03-10' })
    expect(result).toHaveLength(2)
    expect(filterEntries(entries, { type: 'all', from: '2026-03-08', to: '2026-03-11' })).toHaveLength(4)
    expect(filterEntries(entries, { type: 'all', from: '2026-03-12', to: '2026-03-20' })).toHaveLength(0)
  })
})

describe('groupByDay', () => {
  it('puts the newest day first and keeps logged order within a day', () => {
    const groups = groupByDay([
      entry({ type: 'mood', title: 'evening' }, '2026-03-10', 20),
      entry({ type: 'mood', title: 'older' }, '2026-03-09'),
      entry({ type: 'mood', title: 'morning' }, '2026-03-10', 7),
    ])
    expect(groups.map((g) => g.day)).toEqual(['2026-03-10', '2026-03-09'])
    expect(groups[0].entries.map((e) => e.title)).toEqual(['morning', 'evening'])
  })
})

describe('buildSeries', () => {
  it('averages several entries on one day and ignores non-numeric values', () => {
    const [series] = buildSeries([
      entry({ type: 'symptom', title: 'Headache', value: 2 }, '2026-03-10', 8),
      entry({ type: 'symptom', title: 'headache ', value: 6 }, '2026-03-10', 18),
      entry({ type: 'symptom', title: 'Headache', value: 3 }, '2026-03-11'),
      entry({ type: 'symptom', title: 'Headache', value: 'mild' }, '2026-03-12'),
    ])
    expect(series.points).toEqual([
      { day: '2026-03-10', value: 4, count: 2 },
      { day: '2026-03-11', value: 3, count: 1 },
    ])
    expect(series.entryCount).toBe(3)
    expect(series.latest).toBe(3)
    expect(series.average).toBeCloseTo(11 / 3)
    expect(dateKey(new Date(2026, 2, 10))).toBe(series.points[0].day)
  })

  it('orders by type, then by how often it was logged', () => {
    const series = buildSeries([
      entry({ type: 'habit', title: 'Walk', value: 10 }),
      entry({ type: 'symptom', title: 'Rare', value: 1 }),
      entry({ type: 'symptom', title: 'Common', value: 1 }, '2026-03-09'),
      entry({ type: 'symptom', title: 'Common', value: 2 }, '2026-03-10'),
      entry({ type: 'mood', title: 'Mood', value: 3 }),
    ])
    expect(series.map((s) => s.title)).toEqual(['Mood', 'Common', 'Rare', 'Walk'])
  })

  it('returns nothing when there are no numeric entries', () => {
    expect(buildSeries([entry({ type: 'habit', title: 'Walk' })])).toEqual([])
  })
})

describe('summarizeEntries / describeEntries', () => {
  it('summarises count, types and the day span', () => {
    const summary = summarizeEntries([
      entry({ type: 'symptom', title: 'a', value: 1 }, '2026-03-12'),
      entry({ type: 'mood', title: 'b', value: 2 }, '2026-03-10'),
      entry({ type: 'symptom', title: 'c', value: 3 }, '2026-03-10'),
    ])
    expect(summary).toEqual({ count: 3, types: ['mood', 'symptom'], from: '2026-03-10', to: '2026-03-12' })
    const text = describeEntries(summary)
    expect(text).toContain('3 entries')
    expect(text).toContain('Moods, Symptoms')
  })

  it('handles a single entry and an empty list', () => {
    expect(describeEntries(summarizeEntries([entry({ type: 'mood', title: 'a', value: 1 })]))).toMatch(/^1 entry · Moods · /)
    expect(describeEntries(summarizeEntries([]))).toBe('0 entries')
  })
})
