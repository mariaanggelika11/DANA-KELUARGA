import { LoadingState } from "./LoadingState";
import { RefreshButton } from "./RefreshButton";
import { useEffect, useRef, useState } from "react";
import { rupiah as money, dateTime } from "../lib/format";
import { api } from "../lib/api-client";
import "./Workflow.css";
import { useConfirmation } from "../hooks/useConfirmation";
import { Feedback } from "./Feedback";
import { ArrowLeft, Building2, Send } from "lucide-react";
import "./InstallmentPayment.css";

type BankAccount = {
  id: string;
  version: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};
type Payment = {
  id: string;
  amount: string;
  status: string;
  provider: string;
  paidAt: string | null;
  createdAt: string;
  transferredAt: string | null;
  transferReference: string | null;
  transferNotes: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  reviewedBy: { name: string } | null;
  bankAccount: BankAccount | null;
};
type Detail = {
  id: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: string;
  remainingAmount: string;
  paidAmount: string;
  status: string;
  paymentStatus?: string;
  isBorrower?: boolean;
  loan: {
    id: string;
    purpose: string;
    status: string;
    borrower: { name: string };
  };
  payments: Payment[];
  bankAccount: BankAccount | null;
  canReport: boolean;
  canReview: boolean;
  requiresIndependentReviewer: boolean;
};
const statuses: Record<string, string> = {
  UNPAID: "Belum dibayar",
  PARTIAL: "Sebagian dibayar",
  OVERDUE: "Terlambat",
  PAID: "Lunas",
  PENDING: "Menunggu pemeriksaan",
  PENDING_REVIEW: "Menunggu pemeriksaan",
  SUCCESS: "Dikonfirmasi",
  FAILED: "Ditolak",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
};
const date = (value: string) => dateTime.format(new Date(value));
function AccountDetails({ account }: { account: BankAccount }) {
  return (
    <dl className="workflow-details payment-account-details">
      <div>
        <dt>Bank tujuan</dt>
        <dd>{account.bankName}</dd>
      </div>
      <div>
        <dt>Nomor rekening</dt>
        <dd>{account.accountNumber}</dd>
      </div>
      <div>
        <dt>Atas nama</dt>
        <dd>{account.accountHolder}</dd>
      </div>
    </dl>
  );
}
export function InstallmentPayment({
  id,
  onClose,
  onSettled,
}: {
  id: string;
  onClose: () => void;
  onSettled: () => void;
}) {
  const confirm = useConfirmation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [transferAccount, setTransferAccount] = useState<BankAccount | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const reportKey = useRef(crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<{ data: Detail }>(
          `/payments/installments/${encodeURIComponent(id)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setDetail(result.data);
          setTransferAccount((current) => current ?? result.data.bankAccount);
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Cicilan gagal dimuat.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(load, 10000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [id, refresh]);
  const pending =
    Number(detail?.remainingAmount) > 0
      ? detail?.payments.find(
          (payment) =>
            payment.provider === "MANUAL" &&
            payment.bankAccount &&
            payment.status === "PENDING",
        )
      : undefined;
  const latestManual = detail?.payments.find(
    (payment) => payment.provider === "MANUAL" && payment.bankAccount,
  );
  const paymentStatus =
    detail?.paymentStatus ?? (pending ? "PENDING_REVIEW" : detail?.status);
  async function report() {
    if (busy || pending || !detail?.canReport || !transferAccount) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ data: Payment; message: string }>(
        `/payments/loans/${detail.loan.id}/installments/${detail.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: reportKey.current,
            bankAccountId: transferAccount.id,
            expectedRemainingAmount: detail.remainingAmount,
          }),
        },
      );
      if (result.data.status === "PENDING") {
        const payment = {
          ...result.data,
          bankAccount: transferAccount,
          reviewedBy: result.data.reviewedBy ?? null,
        };
        setDetail((current) =>
          current
            ? {
                ...current,
                canReport: false,
                paymentStatus: "PENDING_REVIEW",
                payments: [
                  payment,
                  ...current.payments.filter((row) => row.id !== payment.id),
                ],
              }
            : current,
        );
      }
      setNotice(result.message);
      setRefresh((value) => value + 1);
      reportKey.current = crypto.randomUUID();
      onSettled();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Laporan transfer belum dapat dikirim.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function review(decision: "confirm" | "reject") {
    if (
      busy ||
      !detail?.canReview ||
      !pending ||
      (decision === "reject" && reviewNotes.trim().length < 5)
    )
      return;
    if (
      !(await confirm({
        title:
          decision === "confirm"
            ? "Konfirmasi dana sudah masuk?"
            : "Tolak laporan transfer?",
        message:
          decision === "confirm"
            ? `Pastikan mutasi rekening menunjukkan penerimaan ${money(pending.amount)} ${pending.transferReference ? `dengan referensi ${pending.transferReference}` : `dari ${detail.loan.borrower.name}`}. Konfirmasi akan menambah kas dan mengurangi sisa cicilan.`
            : "Kas dan sisa cicilan tidak berubah. Alasan akan disampaikan kepada peminjam.",
        confirmLabel:
          decision === "confirm" ? "Dana sudah masuk" : "Tolak laporan",
        destructive: decision === "reject",
      }))
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ message: string }>(
        `/payments/${pending.id}/${decision}`,
        { method: "POST", body: JSON.stringify({ notes: reviewNotes }) },
      );
      setNotice(result.message);
      setReviewNotes("");
      setRefresh((value) => value + 1);
      onSettled();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Laporan belum dapat diperiksa.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel workflow-panel installment-payment"
      aria-label="Detail pembayaran cicilan"
    >
      <div className="panel-heading">
        <div>
          <h2>Pembayaran cicilan</h2>
          {detail && (
            <p className="payment-subtitle">
              {detail.loan.borrower.name} · {detail.loan.purpose}
            </p>
          )}
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={onClose}
          disabled={busy}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Kembali ke jadwal
        </button>
      </div>
      {loading && <LoadingState label="Memuat rincian pembayaran..." />}
      {error && (
        <Feedback tone="error">
          {error}
          <button
            className="secondary-button"
            onClick={() => {
              setLoading(true);
              setRefresh((value) => value + 1);
            }}
          >
            Muat ulang
          </button>
        </Feedback>
      )}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {detail && (
        <>
          <dl className="workflow-details payment-overview">
            <div>
              <dt>Cicilan</dt>
              <dd>Ke-{detail.installmentNumber}</dd>
            </div>
            <div>
              <dt>Jatuh tempo</dt>
              <dd>{date(detail.dueDate)} WIB</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span
                  className={`status ${(paymentStatus ?? detail.status).toLowerCase()}`}
                >
                  {statuses[paymentStatus ?? detail.status] ?? paymentStatus}
                </span>
              </dd>
            </div>
          </dl>
          <dl className="payment-amounts">
            <div>
              <dt>Nominal cicilan</dt>
              <dd>{money(detail.principalAmount)}</dd>
            </div>
            <div>
              <dt>Sudah dibayar</dt>
              <dd>{money(detail.paidAmount)}</dd>
            </div>
            <div className="payment-remaining">
              <dt>Sisa cicilan</dt>
              <dd>{money(detail.remainingAmount)}</dd>
            </div>
          </dl>
          {detail.requiresIndependentReviewer && (
            <Feedback tone="info">
              Pembayaran pinjaman Anda harus diperiksa oleh pengelola dana lain
              di keluarga ini.
            </Feedback>
          )}
          {!pending && latestManual?.status === "FAILED" && (
            <Feedback tone="warning" title="Laporan transfer ditolak">
              {latestManual.reviewNotes ??
                "Dana belum dapat dikonfirmasi. Hubungi pengelola dana."}{" "}
              Anda dapat melaporkan kembali setelah menyelesaikan alasan
              penolakan.
            </Feedback>
          )}
          {!pending && detail.canReport && transferAccount && (
            <section
              className="payment-transfer"
              aria-label="Transfer dan laporan pembayaran"
            >
              <div className="payment-bank-card">
                <div className="payment-bank-heading">
                  <Building2 size={20} aria-hidden="true" />
                  <h3>Transfer ke rekening keluarga</h3>
                </div>
                <AccountDetails account={transferAccount} />
              </div>
              {detail.bankAccount &&
                detail.bankAccount.id !== transferAccount.id && (
                  <Feedback tone="info">
                    Rekening keluarga telah berubah. Laporan ini menggunakan
                    rekening yang ditampilkan saat Anda mulai. Jika belum
                    transfer, muat ulang halaman untuk melihat rekening terbaru.
                  </Feedback>
                )}
              <div className="payment-report-action">
                <p>
                  Setelah mentransfer{" "}
                  <strong>{money(detail.remainingAmount)}</strong>, klik tombol
                  berikut. Pengelola dana akan memeriksa uang masuk.
                </p>
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => void report()}
                >
                  <Send size={16} aria-hidden="true" />
                  {busy ? "Mengirim laporan..." : "Saya sudah transfer"}
                </button>
              </div>
            </section>
          )}
          {!pending &&
            !detail.bankAccount &&
            detail.loan.status === "ACTIVE" && (
              <Feedback tone="info">
                Rekening keluarga belum diatur. Hubungi pengelola dana sebelum
                melakukan transfer.
              </Feedback>
            )}
          {!detail.canReport &&
            detail.isBorrower === false &&
            !detail.canReview &&
            !pending &&
            detail.status !== "PAID" && (
              <p>Hanya peminjam dapat melaporkan pembayaran cicilan ini.</p>
            )}
          {pending && (
            <Feedback tone="info">
              Laporan transfer {money(pending.amount)} menunggu pemeriksaan
              pengelola dana. Sisa cicilan belum berkurang. Anda tidak perlu
              mengirim laporan atau mentransfer ulang selama pemeriksaan.
            </Feedback>
          )}
          {pending && detail.canReview && (
            <section className="payment-review">
              <h3>Periksa dana masuk</h3>
              <p>
                Cocokkan nama peminjam, nominal, dan rekening tujuan dengan
                mutasi rekening keluarga. Waktu laporan bukan waktu transfer
                bank.
              </p>
              <div className="payment-field">
                <label htmlFor="payment-review-notes">
                  Catatan pemeriksaan (wajib jika menolak)
                </label>
                <textarea
                  id="payment-review-notes"
                  maxLength={500}
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  disabled={busy}
                  rows={3}
                  placeholder="Tuliskan hasil pemeriksaan atau alasan penolakan"
                  aria-describedby="payment-review-help"
                />
                <small id="payment-review-help">
                  Boleh dikosongkan saat menerima. Alasan penolakan wajib
                  minimal 5 karakter.
                </small>
              </div>
              <div className="workflow-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void review("confirm")}
                >
                  Dana sudah masuk
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || reviewNotes.trim().length < 5}
                  onClick={() => void review("reject")}
                >
                  Tolak laporan
                </button>
              </div>
            </section>
          )}
          <section className="payment-history" aria-label="Riwayat pembayaran">
            <div className="payment-history-heading">
              <h3>Riwayat pembayaran</h3>
              <RefreshButton
                loading={loading}
                disabled={busy}
                className="secondary-button"
                onClick={() => {
                  setLoading(true);
                  setRefresh((value) => value + 1);
                }}
              >
                Perbarui status
              </RefreshButton>
            </div>
            {!detail.payments.length && (
              <p className="payment-history-empty">
                Belum ada laporan pembayaran. Laporan yang dikirim akan tampil
                di sini.
              </p>
            )}
            {detail.payments.map((payment) => (
              <article
                className="workflow-message payment-history-item"
                key={payment.id}
              >
                <div className="workflow-message-heading">
                  <strong>{money(payment.amount)}</strong>
                  <span
                    className={`status ${payment.provider === "MANUAL" && payment.bankAccount ? payment.status.toLowerCase() : "cancelled"}`}
                  >
                    {payment.provider === "MANUAL" && payment.bankAccount
                      ? (statuses[payment.status] ?? payment.status)
                      : "Catatan lama"}
                  </span>
                </div>
                <small>
                  {payment.provider === "MANUAL" && payment.bankAccount
                    ? "Transfer bank"
                    : "Riwayat pembayaran sebelumnya"}{" "}
                  · Dilaporkan {date(payment.createdAt)} WIB
                </small>
                {payment.transferredAt && (
                  <p>Waktu transfer: {date(payment.transferredAt)} WIB</p>
                )}
                {payment.transferReference && (
                  <p>Referensi transfer: {payment.transferReference}</p>
                )}
                {payment.bankAccount && (
                  <AccountDetails account={payment.bankAccount} />
                )}
                {payment.transferNotes && (
                  <p>Catatan peminjam: {payment.transferNotes}</p>
                )}
                {payment.reviewedBy && payment.reviewedAt && (
                  <p>
                    Diperiksa {payment.reviewedBy.name} ·{" "}
                    {date(payment.reviewedAt)} WIB
                  </p>
                )}
                {payment.reviewNotes && (
                  <p>Catatan pemeriksaan: {payment.reviewNotes}</p>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
