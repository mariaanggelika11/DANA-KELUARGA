import { LoadingState } from "../../components/LoadingState";
import { SearchableSelect } from "../../components/SearchableSelect";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api-client";
import { Feedback } from "../../components/Feedback";
import { Modal } from "../../components/Modal";
import { PasswordInput } from "../../components/PasswordInput";
import { ValidatedForm } from "../../components/ValidatedForm";
import { useConfirmation } from "../../hooks/useConfirmation";
import type { SessionUser } from "../../types/navigation";

type Family = { id: string; name: string; code: string };
type Person = { id: string; name: string; email: string | null; phone: string };
type Mode = "NEW_MEMBER" | "NEW_FAMILY" | "EXISTING_MEMBER";
export type RegistrationResult = { family: Family; user: Person; role: string };
const empty = {
  name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  role: "MEMBER",
  familyId: "",
  familyName: "",
  familyCode: "",
  description: "",
};
export function RegistrationDialog({
  user,
  onClose,
  onCreated,
}: {
  user: SessionUser;
  onClose: () => void;
  onCreated: (data: RegistrationResult, message: string) => void;
}) {
  const global = user.systemRole === "SUPER_ADMIN";
  const confirm = useConfirmation();
  const [mode, setMode] = useState<Mode>("NEW_MEMBER");
  const [form, setForm] = useState({
    ...empty,
    familyId: global ? "" : (user.familyId ?? ""),
  });
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyLoading, setFamilyLoading] = useState(global);
  const [familyError, setFamilyError] = useState("");
  const [familyRevision, setFamilyRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!global) return;
    const controller = new AbortController();
    api<{ data: Family[] }>("/management/families", {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setFamilies(data);
          setFamilyError("");
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setFamilyError(
            err instanceof Error
              ? err.message
              : "Daftar keluarga belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setFamilyLoading(false);
      });
    return () => controller.abort();
  }, [global, familyRevision]);
  useEffect(() => {
    if (mode !== "EXISTING_MEMBER" || query.trim().length < 2 || selected)
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ data: Person[] }>(
        `/management/users?search=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      )
        .then(({ data }) => {
          if (!controller.signal.aborted) setResults(data);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted)
            setSearchError(
              err instanceof Error ? err.message : "Pencarian belum berhasil.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mode, selected]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function close() {
    if (busy) return;
    if (
      dirty &&
      !(await confirm({
        title: "Tutup pendaftaran?",
        message: "Isian yang belum disimpan akan hilang.",
        confirmLabel: "Tutup tanpa menyimpan",
        destructive: true,
      }))
    )
      return;
    onClose();
  }
  async function changeMode(value: Mode) {
    if (value === mode || busy) return;
    if (
      dirty &&
      !(await confirm({
        title: "Ganti jenis pendaftaran?",
        message: "Isian sebelumnya akan dikosongkan.",
        confirmLabel: "Ganti jenis",
      }))
    )
      return;
    setMode(value);
    setForm({ ...empty, familyId: global ? "" : (user.familyId ?? "") });
    setQuery("");
    setResults([]);
    setSelected(null);
    setError("");
    setSearchError("");
    setDirty(false);
  }
  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (mode === "EXISTING_MEMBER" && !selected) {
      setError("Pilih akun dari hasil pencarian sebelum menyimpan.");
      return;
    }
    if (mode !== "EXISTING_MEMBER" && form.password !== form.confirmPassword) {
      setError("Konfirmasi password belum sama dengan password.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const body =
        mode === "EXISTING_MEMBER"
          ? {
              type: mode,
              familyId: form.familyId,
              role: form.role,
              existingUserId: selected!.id,
            }
          : {
              ...form,
              name: form.name.trim(),
              email: form.email.trim().toLowerCase(),
              type: mode,
            };
      const { data, message } = await api<{
        data: RegistrationResult;
        message: string;
      }>(global ? "/management/registrations" : "/management/members", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated(
        data,
        mode === "EXISTING_MEMBER"
          ? `${message} Akun tetap memakai email dan password sebelumnya.`
          : `${message} Anggota dapat masuk menggunakan email yang didaftarkan. Sampaikan password melalui jalur yang aman.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Pendaftaran belum berhasil. Silakan coba lagi.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={global ? "Pendaftaran keluarga dan anggota" : "Tambah anggota"}
      onClose={() => void close()}
      busy={busy}
      className="registration-dialog"
    >
      <p className="modal-intro">
        {global
          ? "Pilih apakah Anda ingin membuat keluarga, membuat akun, atau menghubungkan akun yang sudah ada."
          : `Buat akun baru untuk ${user.familyName ?? "keluarga aktif"}. Untuk akun yang sudah ada, hubungi Super Admin.`}
      </p>
      {global && (
        <div
          className="mode-switch three"
          role="group"
          aria-label="Jenis pendaftaran"
        >
          {(
            [
              ["NEW_MEMBER", "Buat akun anggota"],
              ["NEW_FAMILY", "Buat keluarga baru"],
              ["EXISTING_MEMBER", "Hubungkan akun"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              aria-pressed={mode === value}
              className={mode === value ? "selected" : ""}
              onClick={() => void changeMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <ValidatedForm key={mode} onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy} className="form-fields">
          {mode !== "NEW_FAMILY" && global && (
            <SearchableSelect
              label="Keluarga tujuan"
              required
              value={form.familyId}
              disabled={familyLoading || busy}
              options={families.map((family) => ({
                value: family.id,
                label: `${family.name} · ${family.code}`,
              }))}
              onChange={(next) => update("familyId", next)}
            />
          )}
          {global && mode !== "NEW_FAMILY" && familyLoading && (
            <LoadingState label="Memuat keluarga..." />
          )}
          {global && mode !== "NEW_FAMILY" && familyError && (
            <Feedback tone="error">
              {familyError}
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setFamilyLoading(true);
                  setFamilyRevision((value) => value + 1);
                }}
              >
                Coba lagi
              </button>
            </Feedback>
          )}
          {global &&
            mode !== "NEW_FAMILY" &&
            !familyLoading &&
            !familyError &&
            !families.length && (
              <Feedback tone="info">
                Belum ada keluarga. Pilih “Buat keluarga baru” terlebih dahulu.
              </Feedback>
            )}
          {mode === "EXISTING_MEMBER" ? (
            <>
              <label>
                Cari akun
                <input
                  value={query}
                  autoComplete="off"
                  placeholder="Nama, email, atau nomor telepon"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelected(null);
                    setResults([]);
                    setSearchError("");
                    setSearching(event.target.value.trim().length >= 2);
                    setDirty(true);
                  }}
                />
              </label>
              <p className="field-help">
                Ketik minimal dua karakter, lalu pilih akun. Password akun tidak
                diubah.
              </p>
              {searching && !selected && (
                <LoadingState label="Mencari akun..." />
              )}
              {searchError && <Feedback tone="error">{searchError}</Feedback>}
              {!searching &&
                !selected &&
                query.trim().length >= 2 &&
                !searchError &&
                !results.length && (
                  <p>
                    Tidak ada akun aktif yang cocok. Periksa pencarian atau buat
                    akun baru.
                  </p>
                )}
              {results.map((candidate) => (
                <button
                  type="button"
                  className="user-result"
                  key={candidate.id}
                  onClick={() => {
                    setSelected(candidate);
                    setResults([]);
                    setSearching(false);
                  }}
                >
                  <strong>{candidate.name}</strong>
                  <small>{candidate.email ?? candidate.phone}</small>
                </button>
              ))}
              {selected && (
                <Feedback tone="info" title="Akun dipilih">
                  {selected.name} · {selected.email ?? selected.phone}
                </Feedback>
              )}
            </>
          ) : (
            <>
              <h3>
                {mode === "NEW_FAMILY"
                  ? "Akun admin keluarga"
                  : "Identitas anggota"}
              </h3>
              <label>
                Nama lengkap
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="Nama lengkap anggota"
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  maxLength={254}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                  placeholder="nama@contoh.com"
                />
              </label>
              <p className="field-help">
                Email digunakan untuk masuk ke aplikasi.
              </p>
              <label>
                Nomor telepon
                <input
                  required
                  type="tel"
                  inputMode="tel"
                  maxLength={20}
                  pattern="[+0-9 ()\-]{8,20}"
                  data-validation-message="Masukkan nomor telepon yang valid, misalnya 081234567890."
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="081234567890"
                />
              </label>
              <label htmlFor="registration-password">Password awal</label>
              <PasswordInput
                id="registration-password"
                name="Password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="Minimal 8 karakter"
              />
              <label htmlFor="registration-confirm">Konfirmasi password</label>
              <PasswordInput
                id="registration-confirm"
                name="Konfirmasi password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(event) =>
                  update("confirmPassword", event.target.value)
                }
                placeholder="Ulangi password awal"
              />
              {mode === "NEW_FAMILY" && (
                <>
                  <h3>Identitas keluarga</h3>
                  <label>
                    Nama keluarga
                    <input
                      required
                      minLength={2}
                      maxLength={120}
                      value={form.familyName}
                      onChange={(event) =>
                        update("familyName", event.target.value)
                      }
                      placeholder="Nama keluarga"
                    />
                  </label>
                  <label>
                    Kode keluarga
                    <input
                      required
                      minLength={3}
                      maxLength={30}
                      pattern="[A-Z0-9\-]+"
                      value={form.familyCode}
                      onChange={(event) =>
                        update("familyCode", event.target.value.toUpperCase())
                      }
                      placeholder="Kode unik keluarga"
                    />
                  </label>
                  <label>
                    Deskripsi <span className="optional">(opsional)</span>
                    <textarea
                      maxLength={240}
                      value={form.description}
                      onChange={(event) =>
                        update("description", event.target.value)
                      }
                    />
                  </label>
                  <Feedback tone="info">
                    Akun di atas menjadi Admin keluarga. Setelah keluarga
                    dibuat, atur petugas melalui Setup Hirarki sebelum membuat
                    pinjaman.
                  </Feedback>
                </>
              )}
            </>
          )}
          {mode !== "NEW_FAMILY" && (
            <>
              <label>
                Peran dalam keluarga
                <select
                  aria-label="Peran dalam keluarga"
                  value={form.role}
                  onChange={(event) => update("role", event.target.value)}
                >
                  <option value="MEMBER">Anggota</option>
                  <option value="TREASURER">Pengelola dana</option>
                  <option value="ADMIN">Admin keluarga</option>
                </select>
              </label>
              <p className="field-help">
                Admin dapat mengelola anggota dan hirarki keluarga. Pengelola
                dana dapat mengelola catatan kas keluarga. Hak persetujuan dan
                pencairan pinjaman tetap ditentukan melalui Setup Hirarki.
              </p>
            </>
          )}
        </fieldset>
        {error && <Feedback tone="error">{error}</Feedback>}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void close()}
          >
            Batal
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              (global &&
                mode !== "NEW_FAMILY" &&
                (familyLoading || Boolean(familyError) || !families.length))
            }
          >
            {busy
              ? "Menyimpan..."
              : mode === "NEW_FAMILY"
                ? "Buat keluarga dan admin"
                : mode === "EXISTING_MEMBER"
                  ? "Hubungkan akun"
                  : "Tambah anggota"}
          </button>
        </div>
      </ValidatedForm>
    </Modal>
  );
}
