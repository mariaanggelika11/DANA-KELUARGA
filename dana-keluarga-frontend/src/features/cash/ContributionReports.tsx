import { useEffect, useState } from "react";
import { api } from "../../lib/api-client";
import { rupiah, dateTime } from "../../lib/format";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { Pagination } from "../../components/Pagination";
import { useConfirmation } from "../../hooks/useConfirmation";
import { Modal } from "../../components/Modal";

type Report = {
  id: string;
  amount: string;
  purpose: string;
  status: string;
  createdAt: string;
  reviewNotes: string | null;
  reviewedAt: string | null;
  canReview: boolean;
  canReverse: boolean;
  reversalReason: string | null;
  reversedAt: string | null;
  reversedBy: { name: string } | null;
  user: { name: string };
  reviewedBy: { name: string } | null;
  bankAccount: {
    bankName: string;
    accountNumber: string;
    accountHolder: string;
  };
};
const statuses: Record<string, string> = {
  PENDING: "Menunggu pemeriksaan",
  CONFIRMED: "Dikonfirmasi",
  REJECTED: "Ditolak",
  REVERSED: "Dikoreksi",
};
export function ContributionReports({
  revision,
  backgroundRevision,
  onChanged,
}: {
  revision: number;
  backgroundRevision: number;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Report[]; total: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Report | null>(null);
  const [mode, setMode] = useState<"review" | "reverse">("review");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const confirm = useConfirmation();
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: NonNullable<typeof data> }>(
      `/cash/contributions?page=${page}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result.data);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [page, revision, backgroundRevision, refresh]);
  async function review(action: "confirm" | "reject" | "reverse") {
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      if (
        !(await confirm({
          title:
            action === "reverse"
              ? "Koreksi setoran yang dikonfirmasi"
              : action === "confirm"
                ? "Konfirmasi uang setoran masuk"
                : "Tolak laporan setoran",
          message:
            action === "reverse"
              ? `Konfirmasi setoran ${rupiah(selected.amount)} dari ${selected.user.name} akan dibatalkan. Kas dan kontribusi berkurang sebesar nominal tersebut. Riwayat asli tetap tersimpan. Tindakan ini tidak memindahkan uang di bank.`
              : action === "confirm"
                ? `Pastikan ${rupiah(selected.amount)} dari ${selected.user.name} sudah masuk ke rekening keluarga. Kas dan kontribusi akan bertambah.`
                : "Kas dan kontribusi tetap. Alasan penolakan disampaikan kepada penyetor.",
          confirmLabel:
            action === "reverse"
              ? "Koreksi setoran"
              : action === "confirm"
                ? "Dana sudah masuk"
                : "Tolak laporan",
          destructive: action !== "confirm",
        }))
      )
        return;
      const result = await api<{ message: string }>(
        `/cash/contributions/${selected.id}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "reverse" ? { reason: notes } : { notes },
          ),
        },
      );
      setSelected(null);
      setNotice(result.message);
      setRefresh((value) => value + 1);
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Laporan belum dapat diperiksa.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="contribution-reports" aria-label="Laporan setoran">
      <h3>Laporan setoran</h3>
      <p>
        Setoran menambah kas dan kontribusi setelah pengelola dana mengonfirmasi
        uang masuk. Setoran sendiri diperiksa pengelola lain.
      </p>
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {!selected && error && (
        <Feedback tone="error">
          {error}
          <button
            className="secondary-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Muat ulang
          </button>
        </Feedback>
      )}
      {!data && !error && <LoadingState label="Memuat laporan setoran..." />}
      {data && (
        <>
          {!data.items.length && <p>Belum ada laporan setoran.</p>}
          {data.items.map((item) => (
            <article key={item.id} className="workflow-message">
              <div className="workflow-message-heading">
                <strong>
                  {item.user.name} · {rupiah(item.amount)}
                </strong>
                <span
                  className={`status ${item.status === "PENDING" ? "pending" : item.status === "CONFIRMED" ? "paid" : "rejected"}`}
                >
                  {statuses[item.status]}
                </span>
              </div>
              <p>{item.purpose}</p>
              <div className="pending-transfer-footer">
                <small>
                  Dilaporkan {dateTime.format(new Date(item.createdAt))} WIB
                </small>
                {item.canReview && (
                  <button
                    className="primary"
                    onClick={() => {
                      setSelected(item);
                      setMode("review");
                      setNotes("");
                      setError("");
                    }}
                  >
                    Periksa setoran
                  </button>
                )}
                {item.canReverse && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSelected(item);
                      setMode("reverse");
                      setNotes("");
                      setError("");
                    }}
                  >
                    Koreksi setoran
                  </button>
                )}
              </div>
              {item.reviewedBy && (
                <p>
                  Diperiksa {item.reviewedBy.name}
                  {item.reviewedAt &&
                    ` · ${dateTime.format(new Date(item.reviewedAt))} WIB`}
                </p>
              )}
              {item.reviewNotes && <p>{item.reviewNotes}</p>}
              {item.reversalReason && (
                <p>Alasan koreksi: {item.reversalReason}</p>
              )}
              {item.reversedBy && (
                <small>
                  Dikoreksi {item.reversedBy.name}
                  {item.reversedAt &&
                    ` · ${dateTime.format(new Date(item.reversedAt))} WIB`}
                </small>
              )}
            </article>
          ))}
          <Pagination
            page={page}
            total={data.total}
            pageSize={20}
            onChange={setPage}
            disabled={busy}
          />
        </>
      )}
      {selected && (
        <Modal
          title={mode === "reverse" ? "Koreksi setoran" : "Periksa setoran"}
          onClose={() => setSelected(null)}
          busy={busy}
        >
          {error && <Feedback tone="error">{error}</Feedback>}
          <p>
            <strong>
              {selected.user.name} · {rupiah(selected.amount)}
            </strong>
          </p>
          <p>{selected.purpose}</p>
          <dl className="workflow-details">
            <div>
              <dt>Bank tujuan</dt>
              <dd>{selected.bankAccount.bankName}</dd>
            </div>
            <div>
              <dt>Nomor rekening</dt>
              <dd>{selected.bankAccount.accountNumber}</dd>
            </div>
            <div>
              <dt>Atas nama</dt>
              <dd>{selected.bankAccount.accountHolder}</dd>
            </div>
          </dl>
          <label>
            {mode === "reverse"
              ? "Alasan koreksi (wajib, minimal 5 karakter)"
              : "Catatan pemeriksaan (wajib jika menolak)"}
            <textarea
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="dialog-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Batal
            </button>
            <button
              className="danger-button"
              disabled={busy || notes.trim().length < 5}
              onClick={() =>
                void review(mode === "reverse" ? "reverse" : "reject")
              }
            >
              {mode === "reverse" ? "Koreksi setoran" : "Tolak laporan"}
            </button>
            {mode === "review" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void review("confirm")}
              >
                Dana sudah masuk
              </button>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
