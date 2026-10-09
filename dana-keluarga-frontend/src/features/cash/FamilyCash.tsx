import { Pagination } from "../../components/Pagination";
import { useEffect, useState } from "react";
import { LoadingState } from "../../components/LoadingState";
import { Feedback } from "../../components/Feedback";
import { api } from "../../lib/api-client";
import { formatCurrency as money } from "../../lib/currency";
import { date } from "../../lib/format";
import {
  FundTransactionDialog,
  type FundIntent,
} from "./FundTransactionDialog";
type Contribution = {
  deposited: string;
  withdrawn: string;
  available: string;
  reserved: string;
};
type Summary = {
  requestsTotal: number;
  balance: string;
  reserved: string;
  availableCash: string;
  contribution: Contribution;
  loanTotal: string;
  repaid: string;
  outstanding: string;
  contributions: (Contribution & { userId: string; name: string })[];
  requests: {
    id: string;
    amount: string;
    withdrawalAmount: string;
    loanAmount: string;
    status: string;
    createdAt: string;
    user: { name: string };
  }[];
};
const statuses: Record<string, string> = {
  PENDING: "Menunggu persetujuan",
  APPROVED: "Menunggu pencairan",
  ACTIVE: "Sudah dicairkan",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
  PAID_OFF: "Lunas",
};
export function FamilyCash({
  onChanged,
  revision,
  onRequestLoan,
}: {
  onChanged: () => void;
  revision: number;
  onRequestLoan?: () => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [loadedVersion, setLoadedVersion] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<FundIntent | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestVersion = `${refresh}:${revision}:${page}`;
  const loading = loadedVersion !== requestVersion;
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: Summary }>(`/cash?page=${page}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result.data);
          setError("");
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedVersion(requestVersion);
      });
    return () => controller.abort();
  }, [refresh, revision, requestVersion, page]);
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <div>
          <h2>Kas Keluarga</h2>
          <p>Kontribusi pribadi, tarikan, dan pinjaman dicatat terpisah.</p>
        </div>
        <div className="workflow-actions">
          <button
            className="secondary-button"
            disabled={!data || loading}
            onClick={() => setMode("contributions")}
          >
            Setor dana
          </button>
          <button
            className="primary"
            disabled={!data || loading}
            onClick={() => setMode("withdrawals")}
          >
            Tarik kontribusi
          </button>
        </div>
      </div>
      {!mode && error && (
        <Feedback tone="error">
          {error}
          <button onClick={() => setRefresh((value) => value + 1)}>
            Muat ulang
          </button>
        </Feedback>
      )}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {loading && <LoadingState label="Memuat saldo keluarga..." />}
      {data && (
        <>
          <dl className="workflow-details">
            {[
              ["Saldo kas keluarga", data.balance],
              ["Kas tersedia untuk diambil", data.availableCash],
              ["Dana menunggu pencairan", data.reserved],
              ["Total kontribusi saya", data.contribution.deposited],
              ["Kontribusi saya tersedia", data.contribution.available],
              ["Kontribusi saya dicadangkan", data.contribution.reserved],
              ["Total pinjaman saya dicairkan", data.loanTotal],
              ["Sudah saya kembalikan", data.repaid],
              ["Sisa tagihan saya", data.outstanding],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{money(value)}</dd>
              </div>
            ))}
          </dl>
          <h3>Kontribusi anggota</h3>
          <p>
            Rincian anggota lain hanya tersedia bagi Admin dan Pengelola dana.
          </p>
          {data.contributions.map((member) => (
            <article className="workflow-message" key={member.userId}>
              <strong>{member.name}</strong>
              <p>
                Setoran {money(member.deposited)} · Tarikan{" "}
                {money(member.withdrawn)} · Tersedia {money(member.available)}
              </p>
            </article>
          ))}
          <h3>Riwayat pengambilan dana</h3>
          {!data.requests.length && <p>Belum ada permintaan dana.</p>}
          {data.requests.map((request) => (
            <article key={request.id} className="workflow-message">
              <strong>
                {request.user.name} · {money(request.amount)}
              </strong>
              <p>
                Tarikan {money(request.withdrawalAmount)} · Pinjaman{" "}
                {money(request.loanAmount)}
              </p>
              <small>
                {statuses[request.status] ?? request.status} ·{" "}
                {date.format(new Date(request.createdAt))}
              </small>
            </article>
          ))}
          <Pagination
            page={page}
            total={data.requestsTotal}
            pageSize={20}
            disabled={loading}
            onChange={setPage}
          />
        </>
      )}
      {mode && (
        <FundTransactionDialog
          intent={mode}
          onClose={() => setMode(null)}
          onRequestLoan={
            onRequestLoan
              ? () => {
                  setMode(null);
                  onRequestLoan();
                }
              : undefined
          }
          onSaved={(message) => {
            setMode(null);
            setNotice(message);
            setRefresh((value) => value + 1);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
