import { Component, type ReactNode } from "react";
import { Feedback } from "./Feedback";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Do not expose component state, financial data, or stack traces to users.
    console.error("Tampilan aplikasi gagal dimuat.");
  }
  render() {
    if (this.state.failed)
      return (
        <main className="login-page">
          <section className="login-card">
            <h1>Tampilan belum dapat dimuat.</h1>
            <Feedback tone="error">
              Muat ulang aplikasi. Jika masalah berulang, hubungi admin
              keluarga.
            </Feedback>
            <button
              className="primary"
              onClick={() => window.location.reload()}
            >
              Muat ulang aplikasi
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
