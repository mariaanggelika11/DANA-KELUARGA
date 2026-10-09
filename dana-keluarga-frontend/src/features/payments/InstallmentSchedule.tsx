import { ChevronDown } from "lucide-react";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { date, rupiah } from "../../lib/format";
import { loanStatus, installmentStatus } from "../../lib/status-labels";
import type { Loan } from "../../types/finance";
import { groupInstallments } from "./installment-groups";

type Props = {
  loans: Loan[];
  loading: boolean;
  error: string;
  canManageLoans: boolean;
  expandedBorrowers: string[];
  onToggleBorrower: (id: string) => void;
  onOpenPayment: (id: string) => void;
  onRetry: () => void;
};
export function InstallmentSchedule({
  loans,
  loading,
  error,
  canManageLoans,
  expandedBorrowers,
  onToggleBorrower,
  onOpenPayment,
  onRetry,
}: Props) {
  const installmentGroups = groupInstallments(loans);
  return (
    <section className="panel loan-list installment-list">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">JADWAL PEMBAYARAN</p>
          <h2>{canManageLoans ? "Cicilan keluarga" : "Cicilan saya"}</h2>
          <p className="panel-description">
            Pilih nama untuk melihat detail pinjaman dan jadwal cicilannya.
          </p>
        </div>
      </div>
      {loading ? (
        <LoadingState label="Memuat jadwal cicilan..." />
      ) : error ? (
        <Feedback tone="error">
          <p>{error}</p>
          <button className="secondary-button" onClick={onRetry}>
            Coba lagi
          </button>
        </Feedback>
      ) : installmentGroups.length === 0 ? (
        <p className="empty">Belum ada jadwal cicilan.</p>
      ) : (
        <div className="installment-groups">
          {installmentGroups.map((group) => {
            const expanded = expandedBorrowers.includes(group.borrowerId);
            const remaining = group.installments.reduce(
              (total, item) =>
                total +
                BigInt(
                  String(item.installment.remainingAmount).replace(
                    /\.00?$/,
                    "",
                  ),
                ),
              0n,
            );
            const unpaid = group.installments.filter(
              (item) => item.installment.status !== "PAID",
            ).length;
            return (
              <article
                className={
                  expanded ? "installment-group expanded" : "installment-group"
                }
                key={group.borrowerId}
              >
                <button
                  className="installment-group-header"
                  onClick={() => onToggleBorrower(group.borrowerId)}
                  aria-expanded={expanded}
                >
                  <span className="avatar coral">
                    {group.borrowerName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="installment-group-person">
                    <strong>{group.borrowerName}</strong>
                    <small>
                      {group.loans.length} pinjaman · {unpaid} cicilan belum
                      lunas
                    </small>
                  </span>
                  <b>{rupiah(remaining)}</b>
                  <ChevronDown size={18} />
                </button>
                {expanded && (
                  <div className="installment-group-detail">
                    {group.loans.map((loan) => (
                      <div className="installment-loan" key={loan.id}>
                        <div className="installment-loan-heading">
                          <div>
                            <strong>{loan.purpose}</strong>
                            <small>
                              {rupiah(loan.principalAmount)} ·{" "}
                              {loan.tenorMonths} bulan ·{" "}
                              {loanStatus[loan.status] ?? loan.status}
                            </small>
                          </div>
                          <span
                            className={`status ${loan.status.toLowerCase()}`}
                          >
                            {loanStatus[loan.status] ?? loan.status}
                          </span>
                        </div>
                        <div className="installment-detail-list">
                          {loan.installments.map((installment) => (
                            <div
                              className="installment-detail-row"
                              key={installment.id}
                            >
                              <span>
                                Cicilan {installment.installmentNumber}
                              </span>
                              <small>
                                Jatuh tempo{" "}
                                {date.format(new Date(installment.dueDate))}
                              </small>
                              <b>{rupiah(installment.remainingAmount)}</b>
                              <span
                                className={`status ${(installment.paymentStatus ?? installment.status).toLowerCase()}`}
                              >
                                {installmentStatus[
                                  installment.paymentStatus ??
                                    installment.status
                                ] ?? installment.status}
                              </span>
                              <button
                                className="secondary-button"
                                onClick={() => onOpenPayment(installment.id)}
                              >
                                Lihat pembayaran
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
