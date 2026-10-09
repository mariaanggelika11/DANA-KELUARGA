import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api } from "../lib/api-client";
import type { Summary, Loan, LedgerEntry } from "../types/finance";
import type { AppPage, SessionUser } from "../types/navigation";

export function useFinancialData(
  user: SessionUser | null,
  active: AppPage,
  onBackgroundRefresh: Dispatch<SetStateAction<number>>,
) {
  const [summaryError, setSummaryError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const ledgerLoadSequence = useRef(0);
  const loanLoadSequence = useRef(0);
  const summaryLoadSequence = useRef(0);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loansError, setLoansError] = useState("");
  const loadLoans = useCallback(
    async (background = false, signal?: AbortSignal) => {
      const sequence = ++loanLoadSequence.current;
      if (!background) setLoansLoading(true);
      try {
        const result = await api<{ data: Loan[] }>("/loans", { signal });
        if (sequence === loanLoadSequence.current && !signal?.aborted) {
          setLoans(result.data);
          setLoansError("");
        }
      } catch (error) {
        if (sequence === loanLoadSequence.current && !signal?.aborted)
          setLoansError(
            error instanceof Error
              ? error.message
              : "Data pinjaman tidak dapat dimuat",
          );
      } finally {
        if (sequence === loanLoadSequence.current && !signal?.aborted)
          setLoansLoading(false);
      }
    },
    [setLoansLoading, setLoans, setLoansError],
  );
  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++summaryLoadSequence.current;
      try {
        const payload = await api<{ data: Summary }>("/dashboard/summary", {
          signal,
        });
        if (sequence === summaryLoadSequence.current && !signal?.aborted) {
          setSummary(payload.data);
          setSummaryError("");
        }
      } catch (error) {
        if (sequence === summaryLoadSequence.current && !signal?.aborted)
          setSummaryError(
            error instanceof Error
              ? error.message
              : "Ringkasan belum dapat dimuat.",
          );
      }
    },
    [setSummary, setSummaryError],
  );
  const fetchLedger = useCallback(
    (page = ledgerPage) => {
      const sequence = ++ledgerLoadSequence.current;
      return api<{ data: LedgerEntry[]; pagination: { total: number } }>(
        `/ledger?page=${page}`,
      )
        .then((payload) => {
          if (sequence !== ledgerLoadSequence.current) return;
          setLedger(payload.data);
          setLedgerTotal(payload.pagination.total);
          setLedgerError("");
        })
        .catch((error: unknown) => {
          if (sequence !== ledgerLoadSequence.current) return;
          setLedgerError(
            error instanceof Error
              ? error.message
              : "Catatan kas belum dapat dimuat.",
          );
        })
        .finally(() => {
          if (sequence === ledgerLoadSequence.current) setLedgerLoading(false);
        });
    },
    [ledgerPage],
  );
  const loadLedger = (page = ledgerPage) => {
    setLedgerLoading(true);
    setLedgerError("");
    return fetchLedger(page);
  };
  useEffect(() => {
    if (user && user.systemRole !== "SUPER_ADMIN") void fetchLedger(ledgerPage);
    return () => {
      ledgerLoadSequence.current += 1;
    };
  }, [user, ledgerPage, fetchLedger]);
  useEffect(() => {
    if (
      !["Kas", "Ringkasan", "Pinjaman", "Cicilan", "Persetujuan"].includes(
        active,
      ) ||
      !user ||
      user.systemRole === "SUPER_ADMIN"
    )
      return;
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running || document.hidden || controller.signal.aborted) return;
      running = true;
      onBackgroundRefresh((value) => value + 1);
      await Promise.allSettled([
        ...(active === "Kas" ? [fetchLedger(ledgerPage)] : []),
        loadLoans(true, controller.signal),
        loadSummary(controller.signal),
      ]);
      running = false;
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const onResume = () => void refresh();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [
    active,
    user,
    ledgerPage,
    fetchLedger,
    loadLoans,
    loadSummary,
    onBackgroundRefresh,
  ]);
  const resetFinancials = useCallback(() => {
    ledgerLoadSequence.current += 1;
    loanLoadSequence.current += 1;
    summaryLoadSequence.current += 1;
    setLoansLoading(true);
    setLedgerLoading(true);
    setLoans([]);
    setLedger([]);
    setSummary(null);
    setLedgerPage(1);
    setLedgerTotal(0);
    setLoansError("");
    setLedgerError("");
    setSummaryError("");
  }, []);
  const changeLedgerPage = (page: number) => {
    setLedgerLoading(true);
    setLedgerPage(page);
  };
  return {
    summary,
    summaryError,
    loans,
    loansLoading,
    loansError,
    ledger,
    ledgerLoading,
    ledgerError,
    ledgerPage,
    ledgerTotal,
    loadSummary,
    loadLoans,
    loadLedger,
    changeLedgerPage,
    resetFinancials,
  };
}
