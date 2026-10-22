import type { Role } from '@contract'

// Demo-only. These ids must match the users seeded in /web/mocks/seed.ts.
// The role switcher is a demo shortcut, not authentication.
export const PATIENT_ID = 'u-patient'
export const PHYSIO_ID = 'u-physio'
export const GP_ID = 'u-gp'

export interface DemoUser {
  id: string
  label: string
  role: Role
}

export const DEMO_USERS: DemoUser[] = [
  { id: PATIENT_ID, label: 'Patient', role: 'patient' },
  { id: PHYSIO_ID, label: 'Physio', role: 'professional' },
  { id: GP_ID, label: 'GP', role: 'professional' },
]
