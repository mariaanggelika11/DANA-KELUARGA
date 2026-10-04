import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConfirmationProvider } from "./components/ConfirmationProvider";
import "./components/Feedback.css";
import "./components/DesignSystem.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfirmationProvider>
        <App />
      </ConfirmationProvider>
    </ErrorBoundary>
  </StrictMode>,
);
