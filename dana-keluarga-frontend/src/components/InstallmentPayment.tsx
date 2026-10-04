import { LoadingState } from "./LoadingState";
import { RefreshButton } from "./RefreshButton";
import { CurrencyInput } from "./CurrencyInput";
import { currencyError } from "../lib/currency";
import { useEffect, useState } from "react";
import { rupiah as money, dateTime } from "../lib/format";
import { api } from "../lib/api-client";
import "./Workflow.css";
import { useConfirmation } from "../hooks/useConfirmation";
import { Feedback } from "./Feedback";

type Payment = {
  id: string;
  amount: string;
  status: string;
  provider: string;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
};
type Detail = {
  id: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: string;
  remainingAmount: string;
  paidAmount: string;
  status: string;
  loan: {
    id: string;
    purpose: string;
    status: string;
    borrower: { name: string };
  };
  payments: Payment[];
  simulationAvailable: boolean;
  canSimulate: boolean;
};
const date = (value: string) => dateTime.format(new Date(value));
const statuses: Record<string, string> = {
  UNPAID: "Belum dibayar",
  PARTIAL: "Sebagian dibayar",
  OVERDUE: "Terlambat",
  PAID: "Lunas",
  PENDING: "Menunggu konfirmasi",
  SUCCESS: "Berhasil",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
  FAILED: "Gagal",
};

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
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
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Cicilan gagal dimuat");
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
  async function act(path: string, settle = false) {
    if (busy) return;
    if (
      !settle &&
      amount &&
      currencyError(amount, true, "1", detail?.remainingAmount)
    ) {
      setError(currencyError(amount, true, "1", detail?.remainingAmount));
      return;
    }
    if (
      settle &&
      !(await confirm({
        title: "Catat pembayaran simulasi?",
        message:
          "Saldo kas dan sisa pinjaman pada keluarga ini akan berubah. Tidak ada uang nyata yang dipindahkan.",
        confirmLabel: "Catat simulasi",
      }))
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ message: string }>(path, {
        method: "POST",
        ...(!settle && amount ? { body: JSON.stringify({ amount }) } : {}),
      });
      setNotice(result.message);
      setRefresh((value) => value + 1);
      if (settle) onSettled();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Pembayaran gagal diproses",
      );
    } finally {
      setBusy(false);
    }
  }
  const pending = detail?.payments.find(
    (payment) => payment.status === "PENDING",
  );
  return (
    <section
      className="panel workflow-panel"
      aria-label="Detail pembayaran cicilan"
    >
      <div className="panel-heading">
        <h2>Detail cicilan</h2>
        <button className="secondary-button" onClick={onClose}>
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
            Coba lagi
          </button>
        </Feedback>
      )}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {detail && (
        <>
          <p>
            {detail.loan.borrower.name} · {detail.loan.purpose}
          </p>
          <dl className="workflow-details">
            <div>
              <dt>Cicilan</dt>
              <dd>Ke-{detail.installmentNumber}</dd>
            </div>
            <div>
              <dt>Jatuh tempo</dt>
              <dd>{date(detail.dueDate)} WIB</dd>
            </div>
            <div>
              <dt>Nominal cicilan</dt>
              <dd>{money(detail.principalAmount)}</dd>
            </div>
            <div>
              <dt>Sudah dibayar</dt>
              <dd>{money(detail.paidAmount)}</dd>
            </div>
            <div>
              <dt>Sisa cicilan</dt>
              <dd>{money(detail.remainingAmount)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statuses[detail.status] ?? detail.status}</dd>
            </div>
          </dl>
          {detail.simulationAvailable ? (
            <Feedback tone="info">
              Pembayaran simulasi. Tidak ada QRIS yang dapat dibayar dan tidak
              ada uang nyata yang dipindahkan. Konfirmasi simulasi hanya dapat
              dilakukan pengelola.
            </Feedback>
          ) : (
            <Feedback tone="info">
              Pembayaran online belum tersedia. Hubungi pengelola untuk
              informasi lebih lanjut.
            </Feedback>
          )}
          {!pending &&
            detail.status !== "PAID" &&
            detail.simulationAvailable && (
              <CurrencyInput
                label="Nominal pembayaran (kosong untuk seluruh sisa cicilan)"
                value={amount}
                onChange={setAmount}
                max={detail.remainingAmount}
                disabled={busy}
                helperText="Anda dapat membayar sebagian dari sisa cicilan."
              />
            )}
          <div className="workflow-actions">
            {detail.simulationAvailable &&
              detail.loan.status === "ACTIVE" &&
              detail.status !== "PAID" &&
              !pending && (
                <button
                  className="primary"
                  disabled={busy || Boolean(error)}
                  onClick={() =>
                    act(
                      `/payments/loans/${detail.loan.id}/installments/${detail.id}`,
                    )
                  }
                >
                  {busy ? "Memproses..." : "Buat pembayaran simulasi"}
                </button>
              )}
            {pending && (
              <p>
                Menunggu konfirmasi. Berlaku sampai{" "}
                {pending.expiresAt ? `${date(pending.expiresAt)} WIB` : "—"}.
              </p>
            )}
            {pending && detail.canSimulate && (
              <button
                className="primary"
                disabled={busy || Boolean(error)}
                onClick={() =>
                  act(`/payments/${pending.id}/simulate-success`, true)
                }
              >
                {busy ? "Memproses..." : "Simulasikan pembayaran berhasil"}
              </button>
            )}
            <RefreshButton
              loading={loading}
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setLoading(true);
                setRefresh((value) => value + 1);
              }}
            >
              Perbarui status
            </RefreshButton>
          </div>
          <h3>Riwayat pembayaran</h3>
          {!detail.payments.length ? (
            <p>Belum ada pembayaran.</p>
          ) : (
            detail.payments.map((payment) => (
              <article className="workflow-message" key={payment.id}>
                <div className="workflow-message-heading">
                  <strong>{money(payment.amount)}</strong>
                  <span className={`status ${payment.status.toLowerCase()}`}>
                    {statuses[payment.status] ?? payment.status}
                  </span>
                </div>
                <small>
                  {payment.provider === "SANDBOX"
                    ? "Simulasi"
                    : payment.provider}{" "}
                  · Dibuat {date(payment.createdAt)} WIB
                </small>
                {payment.paidAt && (
                  <p>Dikonfirmasi {date(payment.paidAt)} WIB</p>
                )}
              </article>
            ))
          )}
        </>
      )}
    </section>
  );
}
