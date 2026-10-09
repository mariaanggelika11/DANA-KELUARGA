import { ContributionReports } from "./ContributionReports";
import { Pagination } from "../../components/Pagination";
import { useEffect, useState } from "react";
import { LoadingState } from "../../components/LoadingState";
import { Feedback } from "../../components/Feedback";
import { api } from "../../lib/api-client";
import { formatCurrency as money } from "../../lib/currency";
import { date } from "../../lib/format";
import { RefreshButton } from "../../components/RefreshButton";
import "./FamilyCash.css";
import {
  FundTransactionDialog,
  type FundIntent,
} from "./FundTransactionDialog";
type Contribution = {
  deposited: string;
  withdrawn: string;
  available: string;
  reserved: string;
  withdrawable: string;
};
type LoanTotals = { loanTotal: string; repaid: string; outstanding: string };
type Summary = {
  requestsTotal: number;
  balance: string;
  reserved: string;
  availableCash: string;
  contribution: Contribution;
  loanTotal: string;
  repaid: string;
  outstanding: string;
  familyLoanTotals: LoanTotals;
  contributions: (Contribution &
    LoanTotals & { userId: string; name: string })[];
  requests: {
    id: string;
    amount: string;
    withdrawalAmount: string;
    loanAmount: string;
    status: string;
    createdAt: string;
    disbursedAt: string | null;
    paidOffAt: string | null;
    loanProgress: {
      repaid: string;
      outstanding: string;
      paidInstallments: number;
      totalInstallments: number;
    } | null;
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
  backgroundRevision = 0,
}: {
  onChanged: () => void;
  revision: number;
  backgroundRevision?: number;
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
  }, [refresh, revision, requestVersion, page, backgroundRevision]);
  return (
    <section className="panel workflow-panel family-cash">
      <div className="panel-heading">
        <div>
          <h2>Kas Keluarga</h2>
          <p>Saldo keluarga dan perkembangan dana setiap anggota.</p>
        </div>
        <div className="workflow-actions">
          <RefreshButton loading={loading} onClick={onChanged} />
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
          <button
            className="secondary-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Muat ulang
          </button>
        </Feedback>
      )}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {loading && <LoadingState label="Memuat saldo keluarga..." />}
      {data && (
        <>
          <dl className="cash-overview cash-details">
            {[
              ["Saldo kas keluarga", data.balance],
              ["Kas tersedia untuk diambil", data.availableCash],
              ["Dana dicadangkan", data.reserved],
              ["Pinjaman keluarga dicairkan", data.familyLoanTotals.loanTotal],
              ["Cicilan keluarga dikonfirmasi", data.familyLoanTotals.repaid],
              ["Sisa pinjaman keluarga", data.familyLoanTotals.outstanding],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{money(value)}</dd>
              </div>
            ))}
          </dl>
          <details className="cash-personal">
            <summary>Posisi dana saya</summary>
            <dl className="cash-details">
              {[
                ["Total setoran saya", data.contribution.deposited],
                ["Saldo kontribusi saya", data.contribution.available],
                ["Kontribusi saya dicadangkan", data.contribution.reserved],
                ["Bisa saya tarik saat ini", data.contribution.withdrawable],
                ["Pinjaman saya dicairkan", data.loanTotal],
                ["Cicilan saya dikonfirmasi", data.repaid],
                ["Sisa pinjaman saya", data.outstanding],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{money(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
          <h3>Dana dan pinjaman anggota</h3>
          <p className="cash-explanation">
            Saldo kontribusi berasal dari setoran anggota setelah tarikan dan
            pencadangan. Jumlah yang bisa ditarik mengikuti kas keluarga yang
            tersedia. Pembayaran cicilan menambah kas keluarga setelah
            dikonfirmasi.
          </p>
          <p className="cash-privacy">
            Admin dan Pengelola dana dapat melihat rincian seluruh anggota.
          </p>
          {data.contributions.map((member) => (
            <article
              className="workflow-message cash-member"
              key={member.userId}
            >
              <strong>{member.name}</strong>
              <dl className="cash-details cash-contributions">
                {[
                  ["Total setoran", member.deposited],
                  ["Tarikan kontribusi", member.withdrawn],
                  ["Saldo kontribusi", member.available],
                  ["Bisa ditarik saat ini", member.withdrawable],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{money(value)}</dd>
                  </div>
                ))}
              </dl>
              {Number(member.reserved) > 0 && (
                <p>Kontribusi dicadangkan: {money(member.reserved)}</p>
              )}
              {Number(member.loanTotal) > 0 ? (
                <dl className="cash-details cash-member-loan">
                  {[
                    ["Pinjaman dicairkan", member.loanTotal],
                    ["Cicilan dikonfirmasi", member.repaid],
                    ["Sisa pinjaman", member.outstanding],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{money(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <small>Belum ada pinjaman yang dicairkan.</small>
              )}
            </article>
          ))}
          <ContributionReports
            revision={revision + refresh}
            backgroundRevision={backgroundRevision}
            onChanged={onChanged}
          />
          <h3>Riwayat pengambilan dana</h3>
          {!data.requests.length && <p>Belum ada permintaan dana.</p>}
          {data.requests.map((request) => (
            <article key={request.id} className="workflow-message">
              <div className="workflow-message-heading">
                <strong>
                  {request.user.name} · {money(request.amount)}
                </strong>
                <span className={`status ${request.status.toLowerCase()}`}>
                  {request.status === "ACTIVE"
                    ? Number(request.loanAmount) > 0
                      ? "Cicilan berjalan"
                      : "Tarikan dicatat"
                    : (statuses[request.status] ?? request.status)}
                </span>
              </div>
              <p>
                Tarikan kontribusi {money(request.withdrawalAmount)} · Pinjaman{" "}
                {money(request.loanAmount)}
              </p>
              {request.loanProgress && (
                <dl className="cash-details cash-request-progress">
                  <div>
                    <dt>Cicilan dikonfirmasi</dt>
                    <dd>{money(request.loanProgress.repaid)}</dd>
                  </div>
                  <div>
                    <dt>Sisa pinjaman</dt>
                    <dd>{money(request.loanProgress.outstanding)}</dd>
                  </div>
                  <div>
                    <dt>Cicilan lunas</dt>
                    <dd>
                      {request.loanProgress.paidInstallments} dari{" "}
                      {request.loanProgress.totalInstallments}
                    </dd>
                  </div>
                </dl>
              )}
              <div className="cash-request-dates">
                <small>
                  {Number(request.loanAmount) > 0 ? "Diajukan" : "Dicatat"}{" "}
                  {date.format(new Date(request.createdAt))}
                </small>
                {request.disbursedAt && (
                  <small>
                    Dicairkan {date.format(new Date(request.disbursedAt))}
                  </small>
                )}
                {request.paidOffAt && (
                  <small>
                    Lunas {date.format(new Date(request.paidOffAt))}
                  </small>
                )}
              </div>
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
