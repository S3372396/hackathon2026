import { Component } from 'react'
import type { ReactNode } from 'react'

interface State {
  failed: boolean
}

// Last line of defence: an unexpected render error shows a message instead of a blank page.
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="state state-error" role="alert">
        <h2>Something went wrong</h2>
        <p>The page hit an unexpected error. Reloading usually fixes it.</p>
        <button type="button" className="btn" onClick={() => window.location.assign('/')}>
          Reload the app
        </button>
      </div>
    )
  }
}
