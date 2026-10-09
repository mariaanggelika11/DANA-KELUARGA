import { useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, Pencil, Save } from "lucide-react";
import { api } from "../lib/api-client";
import { Feedback } from "./Feedback";
import { LoadingState } from "./LoadingState";
import { useConfirmation } from "../hooks/useConfirmation";
import "./Workflow.css";
import "./BankAccountSettings.css";

type Account = {
  id: string;
  version: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};
export function BankAccountSettings() {
  const confirm = useConfirmation();
  const [data, setData] = useState<{
    account: Account | null;
    canManage: boolean;
  } | null>(null);
  const [form, setForm] = useState({
    bankName: "",
    accountNumber: "",
    accountHolder: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: NonNullable<typeof data> }>("/payments/bank-account", {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setData(data);
          setIsEditing(data.canManage && !data.account);
          setForm({
            bankName: data.account?.bankName ?? "",
            accountNumber: data.account?.accountNumber ?? "",
            accountHolder: data.account?.accountHolder ?? "",
          });
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [revision]);
  function setEditing(editing: boolean) {
    setForm({
      bankName: data?.account?.bankName ?? "",
      accountNumber: data?.account?.accountNumber ?? "",
      accountHolder: data?.account?.accountHolder ?? "",
    });
    setError("");
    setNotice("");
    setIsEditing(editing);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !data?.canManage) return;
    if (
      !(await confirm({
        title: "Simpan rekening keluarga?",
        message:
          "Peminjam akan melihat rekening ini sebagai tujuan transfer. Pastikan bank, nomor rekening, dan nama pemilik sudah benar.",
        confirmLabel: "Simpan rekening",
      }))
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ data: Account; message: string }>(
        "/payments/bank-account",
        {
          method: "PUT",
          body: JSON.stringify({
            ...form,
            expectedVersion: data.account?.version ?? 0,
          }),
        },
      );
      setData({ ...data, account: result.data });
      setIsEditing(false);
      setNotice(result.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Rekening belum dapat disimpan.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel workflow-panel bank-account-panel"
      aria-label="Rekening tujuan keluarga"
    >
      <div className="bank-account-heading">
        <span className="bank-account-icon" aria-hidden="true">
          <Building2 size={24} />
        </span>
        <div>
          <h2>Rekening pembayaran keluarga</h2>
          <p>
            Tujuan transfer cicilan anggota. Pengelola dana mengonfirmasi
            pembayaran setelah uang masuk.
          </p>
        </div>
        {data && (
          <span
            className={`bank-account-status${data.account ? " is-configured" : ""}`}
          >
            {data.account ? "Rekening tersimpan" : "Belum diatur"}
          </span>
        )}
      </div>
      {error && (
        <Feedback tone="error">
          {error}{" "}
          <button
            className="secondary-button"
            onClick={() => setRevision((value) => value + 1)}
            disabled={busy}
          >
            Muat ulang rekening
          </button>
        </Feedback>
      )}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {!data && !error && <LoadingState label="Memuat rekening keluarga..." />}
      {data?.account && (
        <div className="bank-account-summary">
          <div className="bank-account-summary-heading">
            <span className="bank-account-summary-label">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>Rekening tujuan saat ini</span>
            </span>
            {data.canManage && !isEditing && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditing(true)}
              >
                <Pencil size={16} aria-hidden="true" />
                Ubah rekening
              </button>
            )}
          </div>
          <dl className="bank-account-details">
            <div>
              <dt>Bank</dt>
              <dd>{data.account.bankName}</dd>
            </div>
            <div>
              <dt>Nomor rekening</dt>
              <dd className="bank-account-number">
                {data.account.accountNumber}
              </dd>
            </div>
            <div>
              <dt>Atas nama</dt>
              <dd>{data.account.accountHolder}</dd>
            </div>
          </dl>
        </div>
      )}
      {data?.canManage && isEditing ? (
        <form
          className="bank-account-form"
          onSubmit={(event) => void save(event)}
        >
          <fieldset className="bank-account-fields" disabled={busy}>
            <legend>
              {data.account
                ? "Ubah rekening tujuan"
                : "Tambahkan rekening tujuan"}
            </legend>
            <div className="bank-account-grid">
              <div className="bank-account-field">
                <label htmlFor="family-bank-name">Nama bank</label>
                <input
                  id="family-bank-name"
                  required
                  minLength={2}
                  maxLength={80}
                  value={form.bankName}
                  onChange={(event) =>
                    setForm({ ...form, bankName: event.target.value })
                  }
                  disabled={busy}
                  placeholder="Contoh: BCA"
                />
              </div>
              <div className="bank-account-field">
                <label htmlFor="family-account-number">Nomor rekening</label>
                <input
                  id="family-account-number"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6,34}"
                  minLength={6}
                  maxLength={34}
                  value={form.accountNumber}
                  onChange={(event) =>
                    setForm({ ...form, accountNumber: event.target.value })
                  }
                  disabled={busy}
                  placeholder="Contoh: 1234567890"
                  aria-describedby="family-account-number-help"
                />
                <small id="family-account-number-help">
                  Masukkan angka tanpa spasi atau tanda hubung.
                </small>
              </div>
              <div className="bank-account-field">
                <label htmlFor="family-account-holder">
                  Nama pemilik rekening
                </label>
                <input
                  id="family-account-holder"
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.accountHolder}
                  onChange={(event) =>
                    setForm({ ...form, accountHolder: event.target.value })
                  }
                  disabled={busy}
                  placeholder="Sesuai nama pada rekening"
                />
              </div>
            </div>
          </fieldset>
          <div className="bank-account-footer">
            <p>Pastikan semua data benar sebelum menyimpan.</p>
            <div className="bank-account-actions">
              {data.account && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Batal
                </button>
              )}
              <button
                className="primary"
                type="submit"
                disabled={busy}
                aria-busy={busy}
              >
                <Save size={18} aria-hidden="true" />
                {busy ? "Menyimpan..." : "Simpan rekening"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        data &&
        !data.account && (
          <Feedback tone="info">
            Rekening belum diatur. Hubungi pengelola dana keluarga.
          </Feedback>
        )
      )}
    </section>
  );
}
