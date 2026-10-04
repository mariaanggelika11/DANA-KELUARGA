import { LoadingState } from "./LoadingState";
import { RefreshButton } from "./RefreshButton";
import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { dateTime } from "../lib/format";
import { Feedback } from "./Feedback";
import { Pagination } from "./Pagination";
import "./Workflow.css";
type Message = {
  id: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  user: { name: string };
};
const statuses: Record<string, string> = {
  QUEUED: "Dalam antrean",
  PROCESSING: "Sedang dikirim",
  SENT: "Diterima server email",
  SIMULATED: "Simulasi selesai",
  FAILED: "Pengiriman gagal",
  CANCELLED: "Tidak dikirim",
};
export function EmailSettings() {
  const [preferences, setPreferences] = useState<{
    email: string | null;
    mode: string;
  } | null>(null);
  const [inbox, setInbox] = useState<{
    messages: Message[];
    total: number;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<{ data: NonNullable<typeof preferences> }>(
        "/notifications/preferences",
        { signal: controller.signal },
      ),
      api<{ data: NonNullable<typeof inbox> }>(`/notifications?page=${page}`, {
        signal: controller.signal,
      }),
    ])
      .then(([prefs, messages]) => {
        if (!controller.signal.aborted) {
          setPreferences(prefs.data);
          setInbox(messages.data);
          setError("");
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Riwayat email belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, refresh]);
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <h2>Pemberitahuan email</h2>
        <RefreshButton
          loading={loading}
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRefresh((value) => value + 1);
          }}
        >
          Perbarui
        </RefreshButton>
      </div>
      {error && <Feedback tone="error">{error}</Feedback>}
      {loading ? (
        <LoadingState label="Memuat pengaturan email..." />
      ) : (
        preferences && (
          <>
            <p>
              Email akun Anda:{" "}
              <strong>{preferences.email ?? "Belum tersedia"}</strong>
            </p>
            <p>
              Pemberitahuan dikirim ke email yang terdaftar pada akun. Hubungi
              Admin jika alamat email perlu diperbaiki.
            </p>
            {preferences.mode !== "smtp" && (
              <Feedback tone="warning">
                {preferences.mode === "simulation"
                  ? "Pengiriman masih dalam mode simulasi. Belum ada email nyata yang dikirim."
                  : "Pengiriman email belum diaktifkan. Pengelola perlu mengatur layanan SMTP."}
              </Feedback>
            )}
            <h3>Riwayat pengiriman email</h3>
            {!inbox?.messages.length ? (
              <p>Belum ada riwayat pengiriman.</p>
            ) : (
              inbox.messages.map((message) => (
                <article className="workflow-message" key={message.id}>
                  <div className="workflow-message-heading">
                    <strong>{message.subject}</strong>
                    <span>{statuses[message.status] ?? message.status}</span>
                  </div>
                  <small>
                    {message.user.name} ·{" "}
                    {dateTime.format(new Date(message.createdAt))}
                  </small>
                  <p>{message.body}</p>
                  {message.lastError && <p>{message.lastError}</p>}
                  <small>Percobaan pengiriman: {message.attempts}</small>
                </article>
              ))
            )}
            <Pagination
              page={page}
              total={inbox?.total ?? 0}
              pageSize={50}
              disabled={loading}
              onChange={(next) => {
                setPage(next);
                setLoading(true);
              }}
            />
          </>
        )
      )}
    </section>
  );
}
