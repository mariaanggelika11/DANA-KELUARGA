import { LoadingState } from "../../components/LoadingState";
import { SearchableSelect } from "../../components/SearchableSelect";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/api-client";
import { useConfirmation } from "../../hooks/useConfirmation";
import { Feedback } from "../../components/Feedback";
import { ValidatedForm } from "../../components/ValidatedForm";
import "./approvals.css";

type Person = { id: string; name: string; email: string | null };
type Assignment = {
  userId: string;
  permission: string;
  sequence: number;
  user: Person;
};
type FamilyOption = {
  id: string;
  name: string;
  code: string;
  approvalPolicies: { version: number }[];
};
type PolicyData = {
  family: FamilyOption;
  policy: { version: number; assignments: Assignment[] } | null;
  members: { role: string; user: Person }[];
  history: {
    id: string;
    version: number;
    reason: string;
    active: boolean;
    createdAt: string;
    assignments: Assignment[];
  }[];
};

export function HierarchySetup({
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
}) {
  const confirm = useConfirmation();
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [data, setData] = useState<PolicyData | null>(null);
  const [makers, setMakers] = useState<string[]>([]);
  const [approvers, setApprovers] = useState<string[]>([""]);
  const [releaser, setReleaser] = useState("");
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: FamilyOption[] }>("/approval-policies/families", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setFamilies(result.data);
          setFamilyId((id) => id || result.data[0]?.id || "");
          if (!result.data.length) setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Keluarga gagal dimuat",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!familyId) return;
    const controller = new AbortController();
    api<{ data: PolicyData }>(`/approval-policies/families/${familyId}`, {
      signal: controller.signal,
    })
      .then(({ data: result }) => {
        if (controller.signal.aborted) return;
        setData(result);
        const assignments = result.policy?.assignments ?? [];
        setMakers(
          assignments
            .filter((item) => item.permission === "MAKER")
            .map((item) => item.userId),
        );
        const ordered = assignments
          .filter((item) => item.permission === "APPROVER")
          .sort((a, b) => a.sequence - b.sequence)
          .map((item) => item.userId);
        setApprovers(ordered.length ? ordered : [""]);
        setReleaser(
          assignments.find((item) => item.permission === "RELEASER")?.userId ??
            "",
        );
        setReason("");
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Hirarki gagal dimuat");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [familyId, revision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function move(index: number, direction: number) {
    setApprovers((current) => {
      const copy = [...current];
      [copy[index], copy[index + direction]] = [
        copy[index + direction],
        copy[index],
      ];
      return copy;
    });
    setDirty(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !data || data.family.id !== familyId) return;
    if (!makers.length || approvers.some((id) => !id) || !releaser) {
      setError(
        "Pilih minimal satu Maker, seluruh approver, dan satu Releaser.",
      );
      return;
    }
    if (
      new Set(approvers).size !== approvers.length ||
      approvers.includes(releaser)
    ) {
      setError(
        "Approver tidak boleh berulang dan Releaser harus berbeda dari seluruh approver.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<{ message: string }>(
        `/approval-policies/families/${familyId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            expectedVersion: data.policy?.version ?? 0,
            makerIds: makers,
            approverIds: approvers,
            releaserId: releaser,
            reason,
          }),
        },
      );
      setSuccess(result.message);
      setDirty(false);
      setLoading(true);
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hirarki gagal disimpan");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="approval-page">
      <div className="panel hierarchy-family">
        <GitBranch size={24} />
        <div>
          <h2>Setup Hirarki Approval</h2>
          <p>
            Tentukan siapa yang membuat pengajuan, menyetujui secara berurutan,
            dan mencairkan dana.
          </p>
        </div>
        <SearchableSelect
          label="Keluarga"
          value={familyId}
          disabled={saving}
          options={families.map((family) => ({
            value: family.id,
            label: `${family.name} · ${family.code}`,
          }))}
          onChange={async (nextFamily) => {
            if (
              dirty &&
              !(await confirm({
                title: "Pindah keluarga?",
                message: "Perubahan hirarki yang belum disimpan akan hilang.",
                confirmLabel: "Pindah keluarga",
                destructive: true,
              }))
            )
              return;
            setFamilyId(nextFamily);
            setData(null);
            setLoading(Boolean(nextFamily));
            setError("");
            setSuccess("");
            setDirty(false);
          }}
        />
      </div>
      {error && (
        <Feedback tone="error">
          {error}
          <button
            className="secondary-button"
            onClick={() => {
              setError("");
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Muat ulang
          </button>
        </Feedback>
      )}
      {success && <Feedback tone="success">{success}</Feedback>}
      {loading ? (
        <LoadingState label="Memuat konfigurasi..." />
      ) : !families.length ? (
        <Feedback tone="info">Belum ada keluarga yang dapat diatur.</Feedback>
      ) : (
        data?.family.id === familyId && (
          <>
            <Feedback tone="info" title="Urutan berlaku untuk pengajuan baru">
              Urutan: Maker → Approver pertama → Approver kedua → Releaser.
              Setiap approver harus menyetujui sebelum tahap berikutnya. Super
              Admin hanya mengatur hirarki; tidak mendapat hak approval atau
              pencairan.
            </Feedback>
            <ValidatedForm className="panel hierarchy-editor" onSubmit={save}>
              <div className="approval-section-heading">
                <h3>{data.family.name} · Pinjaman</h3>
                <span className="status">
                  {data.policy
                    ? `Versi ${data.policy.version}`
                    : "Belum dikonfigurasi"}
                </span>
              </div>
              <fieldset disabled={saving}>
                <legend>1. Maker — pembuat pengajuan</legend>
                <p>
                  Pilih anggota yang boleh mengajukan. Maker tidak boleh
                  menyetujui atau mencairkan pengajuannya sendiri.
                </p>
                <div className="maker-options">
                  {data.members.map(({ user }) => (
                    <label key={user.id}>
                      <input
                        type="checkbox"
                        checked={makers.includes(user.id)}
                        onChange={(event) => {
                          setMakers((current) =>
                            event.target.checked
                              ? [...current, user.id]
                              : current.filter((id) => id !== user.id),
                          );
                          setDirty(true);
                        }}
                      />
                      <span>
                        {user.name}
                        <small>{user.email}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {makers.some(
                (id) => approvers.includes(id) || id === releaser,
              ) && (
                <Feedback tone="warning">
                  Maker yang juga dipilih sebagai approver atau releaser tidak
                  bisa mengajukan pinjaman dengan hirarki ini. Pisahkan petugas
                  agar anggota tersebut dapat mengajukan.
                </Feedback>
              )}
              <fieldset disabled={saving}>
                <legend>2. Hirarki approver</legend>
                <p>
                  Urutan teratas menyetujui pertama. Gunakan panah untuk
                  mengubah urutan.
                </p>
                <ol className="approver-order">
                  {approvers.map((id, index) => (
                    <li key={index}>
                      <span className="approval-number">{index + 1}</span>
                      <label>
                        <span className="sr-only">
                          Approver tahap {index + 1}
                        </span>
                        <select
                          required
                          aria-label={`Approver tahap ${index + 1}`}
                          value={id}
                          onChange={(event) => {
                            setApprovers((current) =>
                              current.map((value, position) =>
                                position === index ? event.target.value : value,
                              ),
                            );
                            setDirty(true);
                          }}
                        >
                          <option value="">Pilih approver</option>
                          {data.members.map(({ user }) => (
                            <option
                              key={user.id}
                              value={user.id}
                              disabled={
                                user.id !== id &&
                                (approvers.includes(user.id) ||
                                  user.id === releaser)
                              }
                            >
                              {user.name}
                            </option>
                          ))}
                          {id &&
                            !data.members.some(
                              ({ user }) => user.id === id,
                            ) && (
                              <option value={id}>
                                Petugas tidak aktif — ganti pilihan
                              </option>
                            )}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Naikkan tahap ${index + 1}`}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={18} />
                      </button>
                      <button
                        type="button"
                        disabled={index === approvers.length - 1}
                        aria-label={`Turunkan tahap ${index + 1}`}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={18} />
                      </button>
                      <button
                        type="button"
                        disabled={approvers.length === 1}
                        aria-label={`Hapus tahap ${index + 1}`}
                        onClick={() => {
                          setApprovers((current) =>
                            current.filter((_, position) => position !== index),
                          );
                          setDirty(true);
                        }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={approvers.length >= 10}
                  onClick={() => {
                    setApprovers((current) => [...current, ""]);
                    setDirty(true);
                  }}
                >
                  <Plus size={16} />
                  Tambah tahap approval
                </button>
              </fieldset>
              <fieldset disabled={saving}>
                <legend>3. Releaser — pencair dana</legend>
                <label>
                  Petugas pencairan
                  <select
                    required
                    value={releaser}
                    onChange={(event) => {
                      setReleaser(event.target.value);
                      setDirty(true);
                    }}
                  >
                    <option value="">Pilih releaser</option>
                    {releaser &&
                      !data.members.some(
                        ({ user }) => user.id === releaser,
                      ) && (
                        <option value={releaser}>
                          Petugas tidak aktif — ganti pilihan
                        </option>
                      )}
                    {data.members.map(({ user }) => (
                      <option
                        key={user.id}
                        value={user.id}
                        disabled={approvers.includes(user.id)}
                      >
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              <label>
                Alasan pengaturan/perubahan
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setDirty(true);
                  }}
                  placeholder="Contoh: Penetapan petugas keluarga berdasarkan kesepakatan bersama"
                />
              </label>
              {dirty && (
                <p className="hierarchy-unsaved">
                  Ada perubahan yang belum disimpan.
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={saving || !data.members.length}
                >
                  <Save size={17} />
                  {saving ? "Menyimpan..." : "Simpan hirarki"}
                </button>
              </div>
            </ValidatedForm>
            <section className="panel hierarchy-history">
              <h3>Riwayat konfigurasi</h3>
              {!data.history.length ? (
                <p>Belum ada konfigurasi tersimpan.</p>
              ) : (
                <ul>
                  {data.history.map((item) => (
                    <li key={item.id}>
                      <strong>
                        Versi {item.version}
                        {item.active ? " · Aktif" : ""}
                      </strong>
                      <span>
                        {new Date(item.createdAt).toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                        })}{" "}
                        WIB
                      </span>
                      <p>{item.reason}</p>
                      <p>
                        {item.assignments
                          .filter(
                            (assignment) => assignment.permission !== "MAKER",
                          )
                          .sort((a, b) => a.sequence - b.sequence)
                          .map(
                            (assignment) =>
                              `${assignment.sequence}. ${assignment.user.name}${assignment.permission === "RELEASER" ? " (Releaser)" : ""}`,
                          )
                          .join(" → ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Pengajuan berjalan mempertahankan urutan dan petugas dari versi
                saat diajukan. Riwayat keputusan tidak ditimpa.
              </p>
            </section>
          </>
        )
      )}
    </section>
  );
}
