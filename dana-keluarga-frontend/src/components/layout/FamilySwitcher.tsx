import { SearchableSelect } from "../SearchableSelect";
import { useState } from "react";
import { api } from "../../lib/api-client";
import { useConfirmation } from "../../hooks/useConfirmation";
import { Feedback } from "../Feedback";
import type { SessionUser } from "../../types/navigation";

export function FamilySwitcher({ user }: { user: SessionUser }) {
  const confirm = useConfirmation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (
    user.systemRole === "SUPER_ADMIN" ||
    !user.families ||
    user.families.length < 2
  )
    return null;
  async function switchFamily(familyId: string) {
    if (busy || familyId === user.familyId) return;
    if (
      !(await confirm({
        title: "Pindah keluarga?",
        message:
          "Isian yang belum disimpan akan ditinggalkan. Data berikutnya ditampilkan sesuai keluarga yang dipilih.",
        confirmLabel: "Pindah keluarga",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: { accessToken: string } }>(
        "/auth/active-family",
        { method: "POST", body: JSON.stringify({ familyId }) },
      );
      localStorage.setItem("dana_access_token", data.accessToken);
      // Reload drops all cached transaction/form state from the previous family.
      window.location.assign("?view=summary");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Keluarga belum dapat diganti",
      );
      setBusy(false);
    }
  }
  return (
    <section className="family-context">
      <SearchableSelect
        label="Keluarga aktif"
        value={user.familyId ?? ""}
        disabled={busy}
        options={user.families.map((family) => ({
          value: family.id,
          label: family.name,
        }))}
        onChange={(next) => {
          if (next) void switchFamily(next);
        }}
      />
      {busy && <p role="status">Memindahkan ruang keluarga...</p>}
      {error && <Feedback tone="error">{error}</Feedback>}
    </section>
  );
}
