import { LedgerEntryRow } from "../cash/LedgerEntryRow";
import { ArrowUpRight } from "lucide-react";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { rupiah } from "../../lib/format";
import type { Summary, LedgerEntry } from "../../types/finance";

type Props = {
  summary: Summary | null;
  summaryError: string;
  ledger: LedgerEntry[];
  ledgerError: string;
  onOpenCash: () => void;
  onRetry: () => void;
};
export function FamilySummary({
  summary,
  summaryError,
  ledger,
  ledgerError,
  onOpenCash,
  onRetry,
}: Props) {
  return (
    <>
      <section className="welcome">
        <div>
          <p className="kicker">RUANG DANA</p>
          <h2>Ringkasan kas keluarga.</h2>
          <p>
            Saldo dan aktivitas di bawah ini berasal dari catatan kas keluarga
            yang tersimpan di database.
          </p>
          <button className="text-button" onClick={onOpenCash}>
            Buka catatan kas <ArrowUpRight size={15} />
          </button>
        </div>
      </section>
      {!summary && !summaryError && (
        <LoadingState label="Memuat ringkasan keluarga..." />
      )}
      {summaryError && (
        <Feedback tone="error">
          {summaryError}
          <button className="secondary-button" onClick={onRetry}>
            Coba lagi
          </button>
        </Feedback>
      )}
      <div className="section-heading">
        <div>
          <p className="eyebrow">POSISI DANA</p>
          <h2>Gambaran ruang bersama</h2>
        </div>
      </div>
      <section className="metrics">
        <article className="metric primary-metric">
          <p>SALDO BERSAMA</p>
          <small>Saldo kas keluarga</small>
          <strong>
            {summary ? rupiah(summary.balance) : "Belum tersedia"}
          </strong>
          <span className="positive">
            <ArrowUpRight size={14} /> ruang dana aktif
          </span>
        </article>
        <article className="metric">
          <p>Sedang dipinjamkan</p>
          <strong>{summary ? rupiah(summary.loans) : "Belum tersedia"}</strong>
          <small>berdasarkan data aktif</small>
        </article>
        <article className="metric">
          <p>Sisa cicilan belum lunas</p>
          <strong>
            {summary ? rupiah(summary.installments) : "Belum tersedia"}
          </strong>
          <small>dari jadwal pembayaran</small>
        </article>
      </section>
      <section className="panel ledger-list">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AKTIVITAS TERBARU</p>
            <h2>Arus kas terbaru</h2>
          </div>
          <button className="text-button" onClick={onOpenCash}>
            Lihat semua <ArrowUpRight size={15} />
          </button>
        </div>
        {ledgerError ? (
          <Feedback tone="error">{ledgerError}</Feedback>
        ) : ledger.length === 0 ? (
          <p className="empty">Belum ada aktivitas kas.</p>
        ) : (
          <div className="ledger-rows">
            {ledger.slice(0, 5).map((entry) => (
              <LedgerEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
