import type { FormEvent } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
import { Feedback } from "../../components/Feedback";
import { PasswordInput } from "../../components/PasswordInput";
import { ValidatedForm } from "../../components/ValidatedForm";

type Props = {
  email: string;
  password: string;
  busy: boolean;
  error: string;
  errorCode: string;
  onSubmit: (event: FormEvent) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onForgotPassword: () => void;
};
export function LoginForm({
  email,
  password,
  busy,
  error,
  errorCode,
  onSubmit,
  onEmailChange,
  onPasswordChange,
  onForgotPassword,
}: Props) {
  return (
    <div className="login-page">
      <ValidatedForm
        className="login-card"
        onSubmit={onSubmit}
        aria-label="Masuk Dana Keluarga"
        aria-busy={busy}
      >
        <div className="brand">
          <img src="/logo-mark.svg" alt="" />
          <span>
            Dana <i>Keluarga</i>
          </span>
        </div>
        <p className="eyebrow">RUANG BERSAMA</p>
        <h1>Selamat datang kembali.</h1>
        <p className="login-copy">
          Masuk untuk melihat kas, pinjaman, dan aktivitas keluarga.
        </p>
        {error && (
          <Feedback
            tone={
              ["PASSWORD_CHANGED", "PASSWORD_RESET"].includes(errorCode)
                ? "success"
                : errorCode === "AUTH_EMAIL_NOT_REGISTERED"
                  ? "warning"
                  : "error"
            }
            title={
              ["PASSWORD_CHANGED", "PASSWORD_RESET"].includes(errorCode)
                ? "Password berhasil diperbarui"
                : errorCode === "AUTH_EMAIL_NOT_REGISTERED"
                  ? "Email belum terdaftar"
                  : errorCode === "AUTH_PASSWORD_INCORRECT"
                    ? "Password salah"
                    : errorCode === "AUTH_ACCOUNT_INACTIVE"
                      ? "Akun tidak aktif"
                      : undefined
            }
          >
            {error}
          </Feedback>
        )}
        <label htmlFor="login-email">
          Email
          <input
            id="login-email"
            name="Email"
            required
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nama@contoh.com"
            disabled={busy}
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        </label>
        <label htmlFor="login-password">
          Password
          <PasswordInput
            id="login-password"
            name="Password"
            required
            minLength={8}
            autoComplete="current-password"
            placeholder="Masukkan password"
            disabled={busy}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>
        <div className="auth-actions">
          <button className="primary login-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle
                size={18}
                className="loading-spinner"
                aria-hidden="true"
              />
            ) : (
              <LogIn size={18} aria-hidden="true" />
            )}
            {busy ? "Sedang masuk..." : "Masuk"}
          </button>
          <button
            type="button"
            className="text-button auth-link"
            disabled={busy}
            onClick={onForgotPassword}
          >
            Lupa password?
          </button>
        </div>
        <p className="login-help">
          Belum memiliki akun? Hubungi admin keluarga.
        </p>
      </ValidatedForm>
    </div>
  );
}
