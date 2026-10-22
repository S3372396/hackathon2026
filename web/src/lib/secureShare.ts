// STUB: NOT SECURE
//
// Placeholder for the secure sharing interface. Member 2 owns this file and replaces it
// with the real TideCloak-backed version; do not add logic here. Everything below is
// plaintext: nothing is encrypted, and access is only as strong as the (mock) API.
import type { Entry } from '@contract'
import { apiFetch } from '../api/client.ts'

// STUB shape. Member 2's real ProtectedPackage replaces this.
export interface ProtectedPackage {
  recipientId: string
  entries: Entry[]
}

export async function protectEntries(entries: Entry[], recipientId: string): Promise<ProtectedPackage> {
  return { recipientId, entries }
}

// Rejects if access is denied, withdrawn or expired (the API answers 403).
export async function openPackage(shareId: string): Promise<Entry[]> {
  return apiFetch<Entry[]>(`/api/shares/${shareId}/package`)
}

export async function withdrawAccess(_shareId: string): Promise<void> {}
