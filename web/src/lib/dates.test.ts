import { describe, expect, it } from 'vitest'
import { addDays, dateKey, dayKeyToISO, daysInRange, endOfDayISO, isDayKey, todayKey } from './dates.ts'

describe('day keys', () => {
  it('formats local days as YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(todayKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('lists every day in a range, inclusive', () => {
    expect(daysInRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(daysInRange('2026-05-01', '2026-05-01')).toEqual(['2026-05-01'])
    expect(daysInRange('2026-05-02', '2026-05-01')).toEqual([])
    expect(daysInRange('nonsense', '2026-05-01')).toEqual([])
  })

  it('keeps noon entries on the same local day', () => {
    expect(dateKey(dayKeyToISO('2026-06-15'))).toBe('2026-06-15')
    expect(dateKey(endOfDayISO('2026-06-15'))).toBe('2026-06-15')
  })

  it('validates keys', () => {
    expect(isDayKey('2026-06-15')).toBe(true)
    expect(isDayKey('')).toBe(false)
    expect(isDayKey('15/06/2026')).toBe(false)
  })
})
