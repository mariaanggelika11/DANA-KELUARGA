import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, LoaderCircle, Mail } from "lucide-react";
import { api, expireSession } from "../../lib/api-client";
import { Feedback } from "../../components/Feedback";
import { PasswordInput } from "../../components/PasswordInput";
import { ValidatedForm } from "../../components/ValidatedForm";

export function PasswordRecovery({
  mode,
  token,
  onClose,
  onRequestNew,
}: {
  mode: "request" | "reset";
  token: string;
  onClose: () => void;
  onRequestNew: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const validToken = /^[0-9a-f]{64}$/.test(token);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (mode === "reset" && (password !== confirmation || !password.trim())) {
      setError(
        !password.trim()
          ? "Password tidak boleh hanya spasi."
          : "Konfirmasi password belum sama dengan password baru.",
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await api<{ message: string }>(
        mode === "request" ? "/auth/forgot-password" : "/auth/reset-password",
        {
          method: "POST",
          body: JSON.stringify(
            mode === "request"
              ? { email }
              : { token, newPassword: password, confirmPassword: confirmation },
          ),
        },
      );
      if (mode === "reset") {
        setPassword("");
        setConfirmation("");
        expireSession("PASSWORD_RESET");
        onClose();
      } else setNotice(result.message);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Permintaan pemulihan belum berhasil.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <ValidatedForm
        className="login-card"
        onSubmit={submit}
        aria-label={
          mode === "request" ? "Pulihkan password" : "Buat password baru"
        }
        aria-busy={busy}
      >
        <div className="brand">
          <img src="/logo-mark.svg" alt="" />
          <span>
            Dana <i>Keluarga</i>
          </span>
        </div>
        <p className="eyebrow">KEAMANAN AKUN</p>
        <h1>{mode === "request" ? "Lupa password?" : "Buat password baru."}</h1>
        <p className="login-copy">
          {mode === "request"
            ? "Masukkan email akun Anda. Kami akan mengirim tautan pemulihan yang berlaku 30 menit."
            : "Setelah password dipulihkan, masuk kembali dengan password baru. Seluruh sesi akun Anda akan diakhiri."}
        </p>
        {notice && (
          <Feedback tone="success" title="Permintaan diterima">
            {notice}
          </Feedback>
        )}
        {error && <Feedback tone="error">{error}</Feedback>}
        {mode === "request" ? (
          <label htmlFor="recovery-email">
            Email akun
            <input
              id="recovery-email"
              type="email"
              required
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(event) => {
                setEmail(event.target.value);
                setNotice("");
              }}
            />
          </label>
        ) : validToken ? (
          <>
            <label htmlFor="reset-password">
              Password baru
              <PasswordInput
                id="reset-password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label htmlFor="reset-confirmation">
              Konfirmasi password baru
              <PasswordInput
                id="reset-confirmation"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </>
        ) : (
          <Feedback tone="warning">
            Tautan pemulihan tidak lengkap. Buka kembali tautan dari email atau
            minta tautan baru.
          </Feedback>
        )}
        <div className="auth-actions">
          {(mode === "request" || validToken) && (
            <button className="primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle
                  size={18}
                  className="loading-spinner"
                  aria-hidden="true"
                />
              ) : mode === "request" ? (
                <Mail size={18} aria-hidden="true" />
              ) : (
                <KeyRound size={18} aria-hidden="true" />
              )}
              {busy
                ? "Memproses..."
                : mode === "request"
                  ? "Kirim tautan pemulihan"
                  : "Simpan password baru"}
            </button>
          )}
          {mode === "reset" && (
            <button
              type="button"
              className="text-button auth-link"
              disabled={busy}
              onClick={onRequestNew}
            >
              Minta tautan baru
            </button>
          )}
          <button
            type="button"
            className="text-button auth-link"
            disabled={busy}
            onClick={onClose}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Kembali ke halaman masuk
          </button>
        </div>
      </ValidatedForm>
    </main>
  );
}
