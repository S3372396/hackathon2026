import { SECURE_SHARE_IS_STUB, USING_MOCK_API } from '../config.ts'

// Keeps the UI honest about what is real. Mock data and the plaintext stub must never
// look like a secured system.
export default function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <strong>Demo prototype.</strong> Fake data only; please don't enter real health
      information.
      {USING_MOCK_API && ' Data is a mock kept in this browser.'}
      {SECURE_SHARE_IS_STUB && (
        <>
          {' '}
          <strong>Sharing protection is a placeholder, so shared entries are not secured yet.</strong>
        </>
      )}
    </div>
  )
}
