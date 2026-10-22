// Placeholder name until the team picks one (the README still says [App Name]).
export const APP_NAME = 'Health Journal'

// The mock API (MSW, /web/mocks) is on unless VITE_USE_MOCK=false.
export const USING_MOCK_API = import.meta.env.VITE_USE_MOCK !== 'false'

// True while /web/src/lib/secureShare.ts is the plaintext stub. Set to false only when
// Member 2's real implementation replaces it. The UI uses this so it never claims
// protection the system doesn't provide.
export const SECURE_SHARE_IS_STUB = true
