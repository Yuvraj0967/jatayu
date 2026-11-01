import { Component } from 'react'
import type { ReactNode } from 'react'

// A display bug must never leave an operator with a blank page.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{ maxWidth: 560, margin: '15vh auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>The console hit a display error</h1>
        <p style={{ marginBottom: 16 }}>The backend keeps running and recording. The signal view is still available.</p>
        <p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>{' '}
          <a href="/csi">Open the signal view</a>
        </p>
      </div>
    )
  }
}
