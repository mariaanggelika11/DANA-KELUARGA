import { useRef, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, Save } from "lucide-react";
import { api, expireSession } from "../../lib/api-client";
import { PasswordInput } from "../../components/PasswordInput";
import { ValidatedForm } from "../../components/ValidatedForm";
import { Feedback } from "../../components/Feedback";
import "./ChangePassword.css";

export function ChangePassword() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (form.newPassword === form.currentPassword) {
      setError("Password baru harus berbeda dari password lama.");
      newPasswordRef.current?.focus();
      return;
    }
    if (form.confirmPassword !== form.newPassword) {
      setError("Konfirmasi password belum sama dengan password baru.");
      confirmationRef.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/auth/password", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      expireSession("PASSWORD_CHANGED");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Password belum berhasil diubah.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="panel change-password-panel"
      aria-labelledby="change-password-title"
    >
      <div className="change-password-heading">
        <span className="change-password-icon">
          <KeyRound size={24} aria-hidden="true" />
        </span>
        <div>
          <h2 id="change-password-title">Ubah password</h2>
          <p>
            Gunakan password yang berbeda dari akun lain untuk menjaga keamanan
            akun Anda.
          </p>
        </div>
      </div>
      <ValidatedForm
        onSubmit={submit}
        aria-label="Ubah password"
        aria-busy={busy}
      >
        {error && <Feedback tone="error">{error}</Feedback>}
        <div className="change-password-grid">
          <div className="change-password-field">
            <label htmlFor="current-password">Password lama</label>
            <PasswordInput
              id="current-password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={busy}
              value={form.currentPassword}
              onChange={(event) =>
                setForm({ ...form, currentPassword: event.target.value })
              }
            />
          </div>
          <div className="change-password-field">
            <label htmlFor="new-password">Password baru</label>
            <PasswordInput
              id="new-password"
              ref={newPasswordRef}
              name="newPassword"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              disabled={busy}
              value={form.newPassword}
              aria-describedby="password-length-hint"
              onChange={(event) =>
                setForm({ ...form, newPassword: event.target.value })
              }
            />
            <small id="password-length-hint">
              Minimal 8 karakter, maksimal 128 karakter.
            </small>
          </div>
          <div className="change-password-field">
            <label htmlFor="confirm-password">Konfirmasi password baru</label>
            <PasswordInput
              id="confirm-password"
              ref={confirmationRef}
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              disabled={busy}
              value={form.confirmPassword}
              onChange={(event) =>
                setForm({ ...form, confirmPassword: event.target.value })
              }
            />
          </div>
        </div>
        <div className="change-password-footer">
          <p>
            Setelah password diubah, Anda akan keluar dari semua perangkat.
            Masuk kembali dengan password baru.
          </p>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle
                size={18}
                className="loading-spinner"
                aria-hidden="true"
              />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
            {busy ? "Menyimpan..." : "Simpan password"}
          </button>
        </div>
      </ValidatedForm>
    </section>
  );
}
