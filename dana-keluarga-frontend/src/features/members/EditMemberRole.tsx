import { useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { Feedback } from "../../components/Feedback";
import { api } from "../../lib/api-client";

export function EditMemberRole({
  member,
  onClose,
  onSaved,
}: {
  member: {
    id: string;
    role: string;
    user: { name: string };
    family?: { name: string };
  };
  onClose: () => void;
  onSaved: (role: string) => void;
}) {
  const [role, setRole] = useState(member.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || role === member.role) return;
    setBusy(true);
    setError("");
    try {
      await api(`/management/members/${member.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      onSaved(role);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Peran belum berhasil diperbarui. Silakan coba lagi.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit peran anggota" onClose={onClose} busy={busy}>
      <p>
        {member.user.name}
        {member.family ? ` · ${member.family.name}` : ""}
      </p>
      <form onSubmit={submit}>
        {error && <Feedback tone="error">{error}</Feedback>}
        <label>
          Peran dalam keluarga
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            disabled={busy}
          >
            <option value="MEMBER">Anggota</option>
            <option value="TREASURER">Pengelola dana</option>
            <option value="ADMIN">Admin keluarga</option>
          </select>
        </label>
        <p className="field-help">
          Pengelola dana dapat mengelola catatan kas keluarga. Hak persetujuan
          dan pencairan pinjaman tetap mengikuti setup hirarki.
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={busy}
          >
            Batal
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || role === member.role}
          >
            {busy ? "Menyimpan..." : "Simpan perubahan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
