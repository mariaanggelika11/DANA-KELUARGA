import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { api } from "../lib/api-client";
import { Feedback } from "./Feedback";
import { ValidatedForm } from "./ValidatedForm";

export function SupportForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    setNotice("");
    if (message.trim().length < 10) {
      setError("Jelaskan kendala minimal 10 karakter.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/support", {
        method: "POST",
        body: JSON.stringify({ message: message.trim() }),
      });
      setNotice(result.message);
      setMessage("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Pesan bantuan belum berhasil dikirim.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel guide-support" aria-labelledby="support-title">
      <h2 id="support-title">Tanya Super Admin</h2>
      <p>
        Masih mengalami kendala? Ceritakan di bawah ini. Pesan akan dikirim ke
        Super Admin bersama nama, email, peran, dan keluarga aktif Anda.
      </p>
      <ValidatedForm onSubmit={submit} aria-busy={busy}>
        {notice && <Feedback tone="success">{notice}</Feedback>}
        {error && <Feedback tone="error">{error}</Feedback>}
        <label htmlFor="support-message">Kendala yang Anda alami</label>
        <textarea
          id="support-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          disabled={busy}
          aria-describedby="support-message-help"
          placeholder="Jelaskan menu yang digunakan, langkah yang dilakukan, dan kendala yang muncul."
        />
        <small id="support-message-help">
          {message.length}/5.000 karakter. Jangan sertakan password, PIN, atau
          kode OTP.
        </small>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle
              size={18}
              className="loading-spinner"
              aria-hidden="true"
            />
          ) : (
            <Send size={18} aria-hidden="true" />
          )}
          {busy ? "Mengirim..." : "Kirim ke Super Admin"}
        </button>
      </ValidatedForm>
    </section>
  );
}
