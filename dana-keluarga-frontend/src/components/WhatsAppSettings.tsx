import { useEffect, useState } from 'react'
import { api } from '../lib/api-client'
import './Workflow.css'
import { Feedback } from './Feedback'

type Preferences = {
  phone: string
  whatsappOptInAt: string | null
  mode: string
}
type Message = {
  id: string
  kind: string
  body: string
  status: string
  attempts: number
  lastError: string | null
  createdAt: string
  user: { name: string }
  family: { name: string }
}
type Inbox = { messages: Message[]; total: number; page: number; mode: string }
const statuses: Record<string, string> = {
  QUEUED: 'Dalam antrean',
  PROCESSING: 'Diproses',
  SIMULATED: 'Simulasi selesai',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan',
}
const kinds: Record<string, string> = {
  LOAN_REQUESTED: 'Pengajuan pinjaman',
  LOAN_APPROVED: 'Persetujuan',
  LOAN_REJECTED: 'Penolakan',
  LOAN_DISBURSED: 'Pencairan',
  INSTALLMENT_DUE: 'Pengingat cicilan',
  PAYMENT_SUCCESS: 'Pembayaran berhasil',
  LOAN_PAID_OFF: 'Pinjaman lunas',
}
const dates = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
})

export function WhatsAppSettings() {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [inbox, setInbox] = useState<Inbox | null>(null)
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      api<{ data: Preferences }>('/notifications/preferences', {
        signal: controller.signal,
      }),
      api<{ data: Inbox }>(`/notifications?page=${page}`, {
        signal: controller.signal,
      }),
    ])
      .then(([prefs, messages]) => {
        if (!controller.signal.aborted) {
          setPreferences(prefs.data)
          setInbox(messages.data)
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : 'Notifikasi gagal dimuat',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [page, refresh])
  async function changePreference(enabled: boolean) {
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const result = await api<{ data: Preferences }>(
        '/notifications/preferences',
        { method: 'PATCH', body: JSON.stringify({ enabled }) },
      )
      setPreferences(result.data)
      setSaved(
        enabled
          ? 'Persetujuan notifikasi disimpan. Pesan lama yang dibatalkan tidak dikirim ulang.'
          : 'Notifikasi dinonaktifkan dan pesan yang masih antre dibatalkan.',
      )
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pengaturan gagal disimpan')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">WHATSAPP</p>
          <h2>Persetujuan dan riwayat WhatsApp</h2>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setError('')
            setRefresh((value) => value + 1)
          }}
        >
          Perbarui
        </button>
      </div>
      <Feedback tone="info">
        {preferences?.mode === 'disabled'
          ? 'Pemrosesan WhatsApp dinonaktifkan.'
          : 'Mode simulasi — pesan ditampilkan di sini dan belum dikirim ke WhatsApp.'}
      </Feedback>
      {preferences && (
        <div className="workflow-preferences">
          <label>
            <input
              type="checkbox"
              checked={Boolean(preferences.whatsappOptInAt)}
              disabled={saving || loading}
              onChange={(event) => changePreference(event.target.checked)}
            />{' '}
            Saya bersedia menerima pemberitahuan Dana Keluarga melalui WhatsApp.
          </label>
          <p>
            Nomor akun: {preferences.phone}. Pilihan berlaku untuk akun Anda di
            seluruh keluarga dan dapat dinonaktifkan kapan saja.
          </p>
        </div>
      )}
      {saved && <Feedback tone="success">{saved}</Feedback>}
      {error && <Feedback tone="error">{error}</Feedback>}
      {loading ? (
        <p className="empty">Memuat notifikasi...</p>
      ) : (
        !error &&
        inbox && (
          <>
            <h3>Riwayat WhatsApp</h3>
            <p className="panel-description">
              {inbox.total} pesan. Pengelola dapat melihat pesan keluarga yang
              berada dalam aksesnya.
            </p>
            {inbox.messages.length === 0 ? (
              <p className="empty">
                Belum ada pesan. Riwayat akan muncul setelah pengajuan,
                pencairan, pengingat, atau pembayaran.
              </p>
            ) : (
              <div className="workflow-messages">
                {inbox.messages.map((message) => (
                  <article className="workflow-message" key={message.id}>
                    <div className="workflow-message-heading">
                      <strong>{kinds[message.kind] ?? message.kind}</strong>
                      <span
                        className={`status ${message.status.toLowerCase()}`}
                      >
                        {statuses[message.status] ?? message.status}
                      </span>
                    </div>
                    <small>
                      {message.user.name} · {message.family.name} ·{' '}
                      {dates.format(new Date(message.createdAt))} WIB
                    </small>
                    <p className="workflow-message-body">{message.body}</p>
                    {message.lastError && (
                      <p className="workflow-reason">{message.lastError}</p>
                    )}
                    <small>Percobaan pemrosesan: {message.attempts}</small>
                  </article>
                ))}
              </div>
            )}
            <div className="workflow-actions">
              <button
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true)
                  setPage((value) => value - 1)
                }}
              >
                Sebelumnya
              </button>
              <span>Halaman {page}</span>
              <button
                className="secondary-button"
                disabled={page * 50 >= inbox.total}
                onClick={() => {
                  setLoading(true)
                  setPage((value) => value + 1)
                }}
              >
                Berikutnya
              </button>
            </div>
          </>
        )
      )}
    </section>
  )
}
