import { LedgerEntryRow } from "./LedgerEntryRow";
import { ledgerDescription } from "./ledger-description";
import { WalletCards } from "lucide-react";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { Pagination } from "../../components/Pagination";
import type { LedgerEntry, Loan } from "../../types/finance";

type Props = {
  entries: LedgerEntry[];
  loans: Loan[];
  loading: boolean;
  error: string;
  canManageLedger: boolean;
  page: number;
  total: number;
  onCreate: () => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
};
export function LedgerList({
  entries,
  loans,
  loading,
  error,
  canManageLedger,
  page,
  total,
  onCreate,
  onRetry,
  onPageChange,
}: Props) {
  const borrowersByLoan = new Map(
    loans.map((loan) => [loan.id, loan.borrower.name]),
  );
  return (
    <section className="panel ledger-list">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CATATAN KAS</p>
          <h2>Arus kas keluarga</h2>
          <p className="panel-description">
            Catat pemasukan dan pengeluaran agar saldo keluarga tetap akurat.
            Telusuri riwayat melalui navigasi halaman.
          </p>
        </div>
        {canManageLedger && (
          <button className="primary" onClick={onCreate}>
            <WalletCards size={15} />
            Catat kas
          </button>
        )}
      </div>
      {loading ? (
        <LoadingState label="Memuat catatan kas..." />
      ) : error ? (
        <Feedback tone="error">
          {error}
          <button className="secondary-button" onClick={onRetry}>
            Coba lagi
          </button>
        </Feedback>
      ) : entries.length === 0 ? (
        <p className="empty">Belum ada catatan kas.</p>
      ) : (
        <div className="ledger-rows">
          {entries.map((entry) => (
            <LedgerEntryRow
              key={entry.id}
              entry={entry}
              detailed
              description={ledgerDescription(entry, borrowersByLoan)}
            />
          ))}
        </div>
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={20}
        disabled={loading}
        onChange={onPageChange}
      />
    </section>
  );
}
