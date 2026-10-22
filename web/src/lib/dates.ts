// Entries store full ISO timestamps, but the patient thinks in local calendar days.
// A "day key" is that local day as 'YYYY-MM-DD'; keys compare correctly as strings.

const pad = (n: number) => String(n).padStart(2, '0')

// Guards daysInRange against a typo like 1900 → 2900 freezing the tab.
const MAX_DAYS = 3660

export function dateKey(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The one place the wall clock is read, so callers stay easy to reason about and to fake.
export function nowMs(): number {
  return Date.now()
}

export function todayKey(now: Date = new Date()): string {
  return dateKey(now)
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseKey(value).getTime())
}

export function addDays(key: string, days: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

// Every day from `from` to `to`, inclusive. Empty when from is after to.
export function daysInRange(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to && days.length < MAX_DAYS; day = addDays(day, 1)) {
    days.push(day)
  }
  return days
}

// A day key as an ISO timestamp at local noon, so it can't slip into a neighbouring
// day when converted to UTC.
export function dayKeyToISO(key: string): string {
  const d = parseKey(key)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

// Local end of the day, for "expires at the end of this date".
export function endOfDayISO(key: string): string {
  const d = parseKey(key)
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

export function formatDay(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatShortDay(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Value for <input type="datetime-local">, in local time.
export function toDateTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
