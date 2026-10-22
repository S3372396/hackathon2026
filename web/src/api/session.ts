import { PATIENT_ID } from '../demo/demoUsers.ts'

const STORAGE_KEY = 'demoUserId'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

let currentUserId = readStored() ?? PATIENT_ID

// Which demo user the app is acting as. Sent to the mock API as X-Demo-User.
// The real server will identify users from the TideCloak login instead.
export function getCurrentUserId(): string {
  return currentUserId
}

export function setCurrentUserId(id: string) {
  currentUserId = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage can be blocked (private mode); the in-memory value still works.
  }
}
