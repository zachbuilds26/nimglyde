import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app.css";

// Last-resort boundary: a render throw must never blank the app with no
// explanation. Shows a reload prompt instead of a white screen.
class RootBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(err: unknown): void {
    console.error("[nimglyde] render failed", err);
  }
  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <div className="page">
          <div className="card">
            <main className="stage">
              <div className="gate-backdrop">
                <section className="gate-card" role="alert">
                  <img src="/nimglyde-mark.png" alt="" />
                  <h2>Something went wrong</h2>
                  <p>Nimglyde hit an unexpected error. Reload to start fresh — your chats are saved on this device.</p>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => window.location.reload()}
                    autoFocus
                  >
                    Reload Nimglyde
                  </button>
                </section>
              </div>
            </main>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.textContent = "Nimglyde could not start (missing app root).";
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <RootBoundary>
        <App />
      </RootBoundary>
    </React.StrictMode>
  );
}
