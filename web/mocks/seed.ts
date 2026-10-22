import type { Entry, User } from '@contract'
import { GP_ID, PATIENT_ID, PHYSIO_ID } from '../src/demo/demoUsers.ts'

// MOCK DATA: fake people and fake health entries only.
export const SEED_USERS: User[] = [
  { id: PATIENT_ID, name: 'Alex Morgan', role: 'patient' },
  { id: PHYSIO_ID, name: 'Jordan Lee', role: 'professional', profession: 'Physio' },
  { id: GP_ID, name: 'Dr. Casey Patel', role: 'professional', profession: 'GP' },
]

// One value per day, oldest first, so the last item is today. null means nothing logged.
const DAYS = 14
const MOOD = [3, 3, 2, 2, 3, 4, 4, 3, 2, 3, 4, 4, 5, 4]
const BACK_PAIN = [6, 6, 7, 7, 6, null, 5, 6, 4, 4, 3, null, 2, 3]
const HEADACHE = [null, null, 4, 5, null, null, null, null, 3, 2, null, null, null, null]
const STRETCH_MINUTES = [15, 15, null, 20, 15, null, 25, 20, null, 20, 25, null, 30, 25]
const WATER_GLASSES = [6, 5, 7, 6, 8, 5, 6, 7, 6, 8, 7, 6, 8, 7]

const MOOD_NOTES: Record<number, string> = {
  2: 'Slept badly',
  3: 'Long day at the desk',
  6: 'Good walk after lunch',
  8: 'Busy and tense',
  12: 'Felt rested',
}
const BACK_PAIN_NOTES: Record<number, string> = {
  0: 'Stiff when getting up',
  4: 'Worse after sitting',
  8: 'Better after stretching',
  13: 'Mild today',
}

// Dates are relative to `now` so "the last 7 days" always has data.
export function buildSeedEntries(now: Date = new Date()): Entry[] {
  const entries: Entry[] = []
  const at = (daysAgo: number, hour: number, minute = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute).toISOString()

  const add = (entry: Omit<Entry, 'id' | 'patientId'>) => {
    const id = `e-${String(entries.length + 1).padStart(3, '0')}`
    entries.push({ id, patientId: PATIENT_ID, ...entry })
  }

  for (let i = 0; i < DAYS; i++) {
    const daysAgo = DAYS - 1 - i
    add({ type: 'mood', title: 'Daily mood', value: MOOD[i], notes: MOOD_NOTES[i], loggedAt: at(daysAgo, 7, 30) })

    const backPain = BACK_PAIN[i]
    if (backPain !== null) {
      add({ type: 'symptom', title: 'Lower back pain', value: backPain, notes: BACK_PAIN_NOTES[i], loggedAt: at(daysAgo, 9) })
    }
    const headache = HEADACHE[i]
    if (headache !== null) {
      add({ type: 'symptom', title: 'Headache', value: headache, loggedAt: at(daysAgo, 15) })
    }
    const stretch = STRETCH_MINUTES[i]
    if (stretch !== null) {
      add({ type: 'habit', title: 'Stretching (minutes)', value: stretch, loggedAt: at(daysAgo, 8) })
    }
    add({ type: 'habit', title: 'Water (glasses)', value: WATER_GLASSES[i], loggedAt: at(daysAgo, 12) })
  }
  return entries
}
