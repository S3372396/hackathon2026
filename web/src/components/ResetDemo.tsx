import { useState } from 'react'
import { USING_MOCK_API } from '../config.ts'
import { useSession } from '../state/sessionContext.ts'

// Restores the mock data to its starting point so the demo can be run again from the top.
// Hidden when talking to a real server, which has no reset endpoint in the contract.
export default function ResetDemo() {
  const { resetDemo } = useSession()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!USING_MOCK_API) return null

  async function reset() {
    setBusy(true)
    try {
      await resetDemo()
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn btn-small" onClick={() => setConfirming(true)}>
        Reset demo
      </button>
    )
  }

  return (
    <span className="reset-confirm" role="group" aria-label="Confirm reset">
      <span className="small">Erase all demo changes?</span>
      <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={reset}>
        {busy ? 'Resetting…' : 'Reset'}
      </button>
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  )
}
