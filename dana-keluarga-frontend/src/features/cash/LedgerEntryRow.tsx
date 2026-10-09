import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { date, rupiah } from "../../lib/format";
import { ledgerLabels } from "../../lib/status-labels";
import type { LedgerEntry } from "../../types/finance";

type Props = { entry: LedgerEntry; detailed?: boolean; description?: string };

export function LedgerEntryRow({
  entry,
  detailed = false,
  description = entry.description,
}: Props) {
  const incoming = entry.direction === "IN";
  const Icon = incoming ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="ledger-row">
      <span className={`ledger-icon ${incoming ? "incoming" : "outgoing"}`}>
        <Icon size={16} />
      </span>
      <div>
        <strong>{description}</strong>
        {detailed && (
          <>
            <small>{ledgerLabels[entry.type] ?? entry.type} · Tercatat</small>
            {entry.balanceBefore != null && entry.balanceAfter != null && (
              <small>
                Saldo {rupiah(entry.balanceBefore)} →{" "}
                {rupiah(entry.balanceAfter)}
              </small>
            )}
          </>
        )}
        <small>
          {date.format(new Date(entry.occurredAt))}
          {detailed && ` · ${entry.createdBy?.name ?? "Pengelola"}`}
        </small>
      </div>
      <b className={incoming ? "positive" : "negative"}>
        {incoming ? "+" : "−"} {rupiah(entry.amount)}
      </b>
    </div>
  );
}
