import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api-client";
import { currencyError, formatCurrency as money } from "../../lib/currency";
import { CurrencyInput } from "../../components/CurrencyInput";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { Modal } from "../../components/Modal";
import { ValidatedForm } from "../../components/ValidatedForm";
import { useConfirmation } from "../../hooks/useConfirmation";

export type FundIntent = "contributions" | "withdrawals" | "loan-requests";
type Balance = { availableCash: string; contribution: { available: string } };
const titles: Record<FundIntent, string> = {
  contributions: "Setor dana",
  withdrawals: "Tarik kontribusi",
  "loan-requests": "Ajukan kebutuhan dana",
};
export function FundTransactionDialog({
  intent,
  onClose,
  onSaved,
  onRequestLoan,
}: {
  intent: FundIntent;
  onClose: () => void;
  onSaved: (message: string) => void;
  onRequestLoan?: () => void;
}) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [tenor, setTenor] = useState("6");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [withdrawInstead, setWithdrawInstead] = useState(false);
  const key = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const confirm = useConfirmation();
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: Balance }>("/cash", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setBalance(data);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            err instanceof Error ? err.message : "Saldo belum dapat dimuat.",
          );
      });
    return () => controller.abort();
  }, [revision]);
  const deposit = intent === "contributions";
  const requested = BigInt(amount || "0");
  const available = BigInt(balance?.contribution.available || "0");
  const own = requested < available ? requested : available;
  const loan = requested - own;
  const insufficientCash =
    !deposit && requested > BigInt(balance?.availableCash || "0");
  const excessWithdrawal =
    intent === "withdrawals" && (available === 0n || requested > available);
  const covered = intent === "loan-requests" && requested > 0n && loan === 0n;
  const blocked =
    !balance ||
    insufficientCash ||
    excessWithdrawal ||
    (covered && !withdrawInstead);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || blocked || currencyError(amount, true)) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const accepted = await confirm({
        title: deposit
          ? "Konfirmasi pencatatan setoran"
          : loan > 0n
            ? "Konfirmasi pengajuan dana"
            : "Konfirmasi penarikan kontribusi",
        message: deposit
          ? `Catat setoran ${money(amount)} yang sudah Anda serahkan ke kas keluarga? Ini pencatatan, bukan transfer uang melalui aplikasi.`
          : `Total kebutuhan ${money(requested)}. Kontribusi yang digunakan ${money(own)}. Utang baru ${money(loan)}.${loan > 0n ? " Cicilan hanya dihitung dari utang baru. Dana dicadangkan sampai persetujuan dan pencairan selesai." : " Penarikan dicatat tanpa membuat utang baru. Ini pencatatan, bukan transfer uang melalui aplikasi."}`,
        confirmLabel: loan > 0n ? "Kirim pengajuan" : "Lanjutkan",
      });
      if (!accepted) return;
      const path = covered && withdrawInstead ? "withdrawals" : intent;
      const result = await api<{
        data: { loanAmount?: string; withdrawalAmount?: string };
      }>(`/cash/${path}`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          purpose,
          expectedWithdrawal: own.toString(),
          tenorMonths: Number(tenor),
          idempotencyKey: key.current,
        }),
      });
      onSaved(
        deposit
          ? `Setoran ${money(amount)} berhasil dicatat.`
          : BigInt(result.data.loanAmount || "0") > 0n
            ? `Pengajuan ${money(amount)} berhasil dikirim: kontribusi ${money(result.data.withdrawalAmount!)} dan pinjaman ${money(result.data.loanAmount!)}. Menunggu persetujuan dan pencairan.`
            : `Penarikan kontribusi ${money(amount)} berhasil dicatat tanpa utang baru.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Transaksi belum berhasil. Silakan coba lagi.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={titles[intent]} onClose={onClose} busy={busy}>
      {loadError ? (
        <Feedback tone="error">
          {loadError}
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setLoadError("");
              setRevision((value) => value + 1);
            }}
          >
            Coba lagi
          </button>
        </Feedback>
      ) : !balance ? (
        <LoadingState label="Memeriksa kontribusi dan kas tersedia..." />
      ) : (
        <ValidatedForm onSubmit={submit}>
          {error && <Feedback tone="error">{error}</Feedback>}
          <fieldset disabled={busy} className="form-fields">
            {!deposit && (
              <dl className="workflow-details">
                <div>
                  <dt>Kontribusi Anda tersedia</dt>
                  <dd>{money(available)}</dd>
                </div>
                <div>
                  <dt>Kas keluarga tersedia</dt>
                  <dd>{money(balance.availableCash)}</dd>
                </div>
              </dl>
            )}
            {intent === "withdrawals" && available === 0n ? (
              <Feedback tone="warning">
                Anda belum memiliki kontribusi yang bisa ditarik. Untuk
                mengajukan dana, gunakan menu Pinjaman.
              </Feedback>
            ) : (
              <>
                <CurrencyInput
                  label={
                    intent === "loan-requests"
                      ? "Total dana yang dibutuhkan"
                      : "Nominal"
                  }
                  name="amount"
                  required
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    setWithdrawInstead(false);
                  }}
                />
                {intent === "loan-requests" && (
                  <>
                    <dl className="workflow-details">
                      <div>
                        <dt>Kontribusi yang digunakan</dt>
                        <dd>{money(own)}</dd>
                      </div>
                      <div>
                        <dt>Pinjaman baru yang harus dikembalikan</dt>
                        <dd>{money(loan)}</dd>
                      </div>
                    </dl>
                    {loan > 0n && (
                      <>
                        <Feedback tone="info">
                          Kontribusi Anda berkurang sebesar bagian yang
                          digunakan saat pencairan. Cicilan hanya dihitung dari
                          pinjaman baru. Pengajuan mengikuti hirarki persetujuan
                          keluarga.
                        </Feedback>
                        <label>
                          Tenor pinjaman (bulan)
                          <input
                            type="number"
                            min="1"
                            max="60"
                            required
                            value={tenor}
                            onChange={(event) => setTenor(event.target.value)}
                          />
                        </label>
                      </>
                    )}
                    {covered && (
                      <Feedback tone="info">
                        Kontribusi Anda mencukupi kebutuhan ini. Tidak perlu
                        membuat pinjaman.
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setWithdrawInstead(true)}
                          disabled={withdrawInstead}
                        >
                          {withdrawInstead
                            ? "Penarikan kontribusi dipilih"
                            : "Gunakan penarikan kontribusi"}
                        </button>
                      </Feedback>
                    )}
                  </>
                )}
                {excessWithdrawal && (
                  <Feedback tone="warning">
                    Penarikan maksimal {money(available)}. Ajukan kekurangannya
                    melalui menu Pinjaman.
                  </Feedback>
                )}
                {insufficientCash && (
                  <Feedback tone="warning">
                    Kas keluarga yang tersedia belum mencukupi kebutuhan ini.
                  </Feedback>
                )}
                <label>
                  Keterangan / tujuan
                  <textarea
                    required
                    minLength={3}
                    maxLength={240}
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                  />
                </label>
              </>
            )}
          </fieldset>
          <div className="dialog-actions">
            {excessWithdrawal && onRequestLoan && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={onRequestLoan}
              >
                Ajukan pinjaman
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              Batal
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || blocked}
            >
              {busy
                ? "Memproses..."
                : deposit
                  ? "Catat setoran"
                  : intent === "withdrawals" || (covered && withdrawInstead)
                    ? "Tarik kontribusi"
                    : "Kirim pengajuan"}
            </button>
          </div>
        </ValidatedForm>
      )}
    </Modal>
  );
}
