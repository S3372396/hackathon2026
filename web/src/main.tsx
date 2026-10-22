import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { USING_MOCK_API } from './config.ts'
import { SessionProvider } from './state/SessionProvider.tsx'

async function enableMocking() {
  if (!USING_MOCK_API) return
  const { worker } = await import('../mocks/browser.ts')
  await worker.start({ onUnhandledFrame: 'bypass' })
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <SessionProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </SessionProvider>
      </BrowserRouter>
    </StrictMode>,
  )
})
