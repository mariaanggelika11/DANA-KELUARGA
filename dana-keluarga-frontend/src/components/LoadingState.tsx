import { LoaderCircle } from "lucide-react";
import "./LoadingState.css";

/** Shared, accessible status for pending reads; empty states belong after completion. */
export function LoadingState({ label = "Memuat data..." }: { label?: string }) {
  return (
    <div
      className="loading-state"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderCircle size={22} className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
