import { HandCoins } from "lucide-react";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { date, rupiah } from "../../lib/format";
import { loanStatus } from "../../lib/status-labels";
import type { Loan } from "../../types/finance";

type Props = {
  loans: Loan[];
  loading: boolean;
  error: string;
  canManageLoans: boolean;
  canRequestLoan: boolean;
  permissions: {
    error: string;
    data: { configured: boolean; canCreateLoan: boolean } | null;
  };
  onRequest: () => void;
  onRetry: () => void;
  onOpenApproval: (id: string) => void;
};
export function LoanList({
  loans,
  loading,
  error,
  canManageLoans,
  canRequestLoan,
  permissions,
  onRequest,
  onRetry,
  onOpenApproval,
}: Props) {
  return (
    <section className="panel loan-list">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RUANG DANA</p>
          <h2>{canManageLoans ? "Kelola pinjaman" : "Pinjaman saya"}</h2>
          <p className="panel-description">
            {canManageLoans
              ? "Tinjau pengajuan dan kelola pencairan dana keluarga."
              : "Pantau status pengajuan dan jadwal pengembalian dana Anda."}
          </p>
        </div>
        {canRequestLoan && (
          <button className="primary" onClick={onRequest}>
            <HandCoins size={15} />
            Ajukan pinjaman
          </button>
        )}
      </div>
      {permissions.error && (
        <Feedback tone="error">{permissions.error}</Feedback>
      )}
      {permissions.data && !permissions.data.canCreateLoan && (
        <Feedback tone="info">
          {!permissions.data.configured
            ? "Hirarki pinjaman belum diatur. Hubungi Admin keluarga atau Super Admin untuk mengisi Setup Hirarki."
            : "Pengajuan hanya tersedia untuk Maker yang tidak menjadi approver atau releaser dalam hirarki ini. Hubungi pengelola untuk penyesuaian petugas."}
        </Feedback>
      )}
      {loading ? (
        <LoadingState label="Memuat data pinjaman..." />
      ) : error ? (
        <Feedback tone="error">
          <p>{error}</p>
          <button className="secondary-button" onClick={onRetry}>
            Coba lagi
          </button>
        </Feedback>
      ) : loans.length === 0 ? (
        <p className="empty">Belum ada data pinjaman.</p>
      ) : (
        loans.map((loan) => (
          <div className="loan-row" key={loan.id}>
            <div>
              <strong>{loan.borrower.name}</strong>
              <small>
                {loan.purpose} · {loan.tenorMonths} bulan · Diajukan{" "}
                {date.format(new Date(loan.requestedAt))}
              </small>
              {["REJECTED", "CANCELLED"].includes(loan.status) &&
                loan.rejectionReason && (
                  <small className="rejection-reason">
                    Alasan: {loan.rejectionReason}
                  </small>
                )}
            </div>
            <b>{rupiah(loan.principalAmount)}</b>
            <span className={`status ${loan.status.toLowerCase()}`}>
              {loanStatus[loan.status] ?? loan.status}
            </span>
            {["PENDING", "APPROVED"].includes(loan.status) && (
              <div className="loan-actions">
                {loan.approvalRequest ? (
                  <button
                    className="secondary-button"
                    onClick={() => onOpenApproval(loan.approvalRequest!.id)}
                  >
                    Lihat persetujuan
                  </button>
                ) : (
                  <small>
                    Pinjaman lama: perlu tinjauan migrasi oleh pengelola.
                  </small>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}
