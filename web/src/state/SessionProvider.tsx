import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@contract'
import { api } from '../api/client.ts'
import { getCurrentUserId, setCurrentUserId } from '../api/session.ts'
import { PATIENT_ID } from '../demo/demoUsers.ts'
import { SessionContext } from './sessionContext.ts'
import type { Session } from './sessionContext.ts'

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [userId, setUserId] = useState(getCurrentUserId)
  const [epoch, setEpoch] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; user: User } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)

  // Results are tagged with the key they were fetched for, so after a switch the
  // previous user is never reported as the current one.
  const key = `${userId}:${epoch}`

  useEffect(() => {
    let cancelled = false
    api.me().then(
      (user) => {
        if (!cancelled) setLoaded({ key, user })
      },
      (err: Error) => {
        if (!cancelled) setFailed({ key, message: err.message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [key])

  const switchUser = useCallback((id: string) => {
    setCurrentUserId(id)
    setUserId(id)
  }, [])

  const reload = useCallback(() => setEpoch((e) => e + 1), [])

  const resetDemo = useCallback(async () => {
    // Loaded on demand so the mock database is never pulled in when talking to a real server.
    const { resetDb } = await import('../../mocks/db.ts')
    resetDb()
    setCurrentUserId(PATIENT_ID)
    setUserId(PATIENT_ID)
    setEpoch((e) => e + 1)
    navigate('/')
  }, [navigate])

  const value = useMemo<Session>(
    () => ({
      user: loaded?.key === key ? loaded.user : null,
      error: failed?.key === key ? failed.message : null,
      epoch,
      switchUser,
      reload,
      resetDemo,
    }),
    [loaded, failed, key, epoch, switchUser, reload, resetDemo],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
