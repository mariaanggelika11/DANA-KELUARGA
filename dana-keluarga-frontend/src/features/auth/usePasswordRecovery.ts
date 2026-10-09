import { useEffect, useRef, useState } from "react";

type Recovery = { mode: "request" | "reset"; token: string };
function readLocation(savedToken = ""): Recovery | null {
  const query = new URLSearchParams(window.location.search);
  if (query.get("view") === "forgot-password")
    return { mode: "request", token: "" };
  if (query.get("view") === "reset-password")
    return { mode: "reset", token: query.get("token") ?? savedToken };
  return null;
}
export function usePasswordRecovery() {
  const [recovery, setRecovery] = useState(readLocation);
  const token = useRef(recovery?.token ?? "");
  useEffect(() => {
    const scrubToken = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.has("token")) {
        url.searchParams.delete("token");
        window.history.replaceState(
          null,
          "",
          url.pathname + url.search + url.hash,
        );
      }
    };
    scrubToken();
    const restore = () => {
      const next = readLocation(token.current);
      if (next?.token) token.current = next.token;
      setRecovery(next);
      scrubToken();
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  return {
    recovery,
    open: () => {
      setRecovery({ mode: "request", token: "" });
      window.history.pushState(null, "", "?view=forgot-password");
    },
    close: () => {
      token.current = "";
      setRecovery(null);
      window.history.replaceState(null, "", "?view=summary");
    },
  };
}
