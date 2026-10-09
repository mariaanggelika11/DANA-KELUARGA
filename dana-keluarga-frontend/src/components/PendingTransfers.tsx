import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { rupiah, dateTime } from "../lib/format";
import { Feedback } from "./Feedback";
import { LoadingState } from "./LoadingState";
import { Pagination } from "./Pagination";
type Item = {
  id: string;
  installmentId: string;
  amount: string;
  createdAt: string;
  transferredAt: string | null;
  transferReference: string | null;
  loan: { borrower: { name: string }; purpose: string };
  installment: { installmentNumber: number };
};
export function PendingTransfers({
  onOpen,
  revision,
}: {
  onOpen: (id: string) => void;
  revision: number;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Item[]; total: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: NonNullable<typeof data> }>(`/payments/pending?page=${page}`, {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setData(data);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, revision, refresh]);
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <h2>Transfer menunggu pemeriksaan</h2>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRefresh((value) => value + 1);
          }}
        >
          Perbarui
        </button>
      </div>
      <p>
        Periksa mutasi rekening sebelum mengonfirmasi. Laporan pembayaran
        pinjaman sendiri tidak ditampilkan di antrean Anda.
      </p>
      {error && <Feedback tone="error">{error}</Feedback>}
      {loading ? (
        <LoadingState label="Memuat laporan transfer..." />
      ) : (
        data && (
          <>
            {!data.items.length && (
              <p>Belum ada laporan transfer yang menunggu pemeriksaan.</p>
            )}
            {data.items.map((item) => (
              <article className="workflow-message" key={item.id}>
                <strong>
                  {item.loan.borrower.name} · {rupiah(item.amount)}
                </strong>
                <p>
                  Cicilan ke-{item.installment.installmentNumber} ·{" "}
                  {item.loan.purpose}
                </p>
                <small>
                  Dilaporkan {dateTime.format(new Date(item.createdAt))} WIB
                  {item.transferReference && (
                    <> · Referensi {item.transferReference}</>
                  )}
                </small>
                <button
                  className="secondary-button"
                  onClick={() => onOpen(item.installmentId)}
                >
                  Periksa transfer
                </button>
              </article>
            ))}
            <Pagination
              page={page}
              total={data.total}
              pageSize={20}
              disabled={loading}
              onChange={(value) => {
                setLoading(true);
                setPage(value);
              }}
            />
          </>
        )
      )}
    </section>
  );
}
