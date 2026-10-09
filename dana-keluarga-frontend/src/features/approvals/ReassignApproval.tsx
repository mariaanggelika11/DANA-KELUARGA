import { useEffect, useState } from "react";
import { api } from "../../lib/api-client";
import { Feedback } from "../../components/Feedback";
import { useConfirmation } from "../../hooks/useConfirmation";

type Data = {
  candidates: { id: string; name: string }[];
  history: {
    id: string;
    createdAt: string;
    actor: { name: string };
    after: { step: number; name: string; reason: string };
  }[];
};
export function ReassignApproval({
  requestId,
  current,
  onChanged,
}: {
  requestId: string;
  current?: { assignedUserId: string; sequence: number };
  onChanged: () => void;
}) {
  const confirm = useConfirmation();
  const [data, setData] = useState<Data | null>(null);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: Data }>(`/approvals/${requestId}/reassignments`, {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) setData(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [requestId, revision, current?.assignedUserId]);
  async function reassign() {
    if (!current || busy || !userId || reason.trim().length < 5) return;
    if (
      !(await confirm({
        title: "Ganti petugas tahap ini?",
        message:
          "Petugas lama tidak lagi dapat memproses tahap ini. Alasan dan petugas pengganti dicatat dalam riwayat.",
        confirmLabel: "Ganti petugas",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/approvals/${requestId}/reassign`, {
        method: "POST",
        body: JSON.stringify({
          userId,
          reason,
          expectedAssignedUserId: current.assignedUserId,
        }),
      });
      setUserId("");
      setReason("");
      setRevision((value) => value + 1);
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Petugas belum dapat diganti.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="approval-action-area">
      {error && <Feedback tone="error">{error}</Feedback>}
      {current && (
        <>
          <h3>Ganti petugas tahap {current.sequence}</h3>
          <p>
            Gunakan bila petugas berhalangan. Pemohon dan petugas tahap lain
            tidak dapat dipilih.
          </p>
          <label>
            Petugas pengganti
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              disabled={busy || !data}
            >
              <option value="">Pilih anggota aktif</option>
              {data?.candidates.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          {data && !data.candidates.length && (
            <p>Belum ada anggota aktif yang memenuhi syarat.</p>
          )}
          <label>
            Alasan penggantian
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={5}
              maxLength={500}
              disabled={busy}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || !userId || reason.trim().length < 5}
            onClick={() => void reassign()}
          >
            {busy ? "Menyimpan..." : "Ganti petugas"}
          </button>
        </>
      )}
      {Boolean(data?.history.length) && (
        <>
          <h3>Riwayat penggantian petugas</h3>
          {data?.history.map((event) => (
            <article key={event.id}>
              <strong>
                Tahap {event.after.step} dialihkan ke {event.after.name}
              </strong>
              <p>{event.after.reason}</p>
              <small>
                {event.actor.name} ·{" "}
                {new Date(event.createdAt).toLocaleString("id-ID")}
              </small>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
