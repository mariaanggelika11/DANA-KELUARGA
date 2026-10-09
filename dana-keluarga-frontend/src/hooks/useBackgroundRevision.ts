import { useEffect, useState } from "react";

// Keep forms and expanded rows intact; only refetch data while the page is visible.
export function useBackgroundRevision(enabled = true, intervalMs = 15000) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (!document.hidden) setRevision((value) => value + 1);
    };
    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, intervalMs]);
  return revision;
}
