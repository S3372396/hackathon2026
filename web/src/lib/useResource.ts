import { useEffect, useRef, useState } from 'react'

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error }

// Loads data on mount and whenever `key` changes, dropping any response that arrives
// after the key changed or the component unmounted. `reload` refetches while keeping the
// current data on screen, so lists don't flash back to a spinner after an action.
export function useResource<T>(load: () => Promise<T>, key: string = '') {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' })
  const [reloads, setReloads] = useState(0)
  const loadRef = useRef(load)
  const loadedKey = useRef<string | null>(null)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false
    if (loadedKey.current !== key) {
      loadedKey.current = key
      setState({ status: 'loading' })
    }
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data })
      },
      (error: Error) => {
        if (!cancelled) setState({ status: 'error', error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [key, reloads])

  return { state, reload: () => setReloads((n) => n + 1) }
}
