import { useEffect, useState } from 'react'
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { api } from '../../lib/api-client'
import { Feedback } from '../Feedback'
import type { AppPage } from '../../types/navigation'
import './Notifications.css'

type Notification = {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
  metadata: { installmentId?: string; view?: string } | null
  family: { name: string } | null
}
type Inbox = {
  items: Notification[]
  total: number
  unreadCount: number
  page: number
}
type Props = {
  onUnreadChanged: () => void
  onNavigate: (page: AppPage) => void
  onOpenInstallment: (id: string) => void
}
const dateTime = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
})

export function NotificationInbox({
  onUnreadChanged,
  onNavigate,
  onOpenInstallment,
}: Props) {
  const [data, setData] = useState<Inbox | null>(null)
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let inFlight = false
    async function load() {
      if (inFlight || document.hidden) return
      inFlight = true
      try {
        const result = await api<{ data: Inbox }>(
          `/notifications/inbox?page=${page}&unread=${unreadOnly}`,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) {
          setData(result.data)
          setError('')
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : 'Notifikasi belum dapat dimuat',
          )
      } finally {
        inFlight = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(load, 30000)
    document.addEventListener('visibilitychange', load)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [page, unreadOnly, revision])
  function refresh() {
    setLoading(true)
    setError('')
    setRevision((value) => value + 1)
    onUnreadChanged()
  }
  async function markRead(item?: Notification, openDetails = false) {
    if (busy) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      if (!item || !item.isRead) {
        await api(
          item
            ? `/notifications/inbox/${item.id}/read`
            : '/notifications/inbox/read-all',
          { method: 'PATCH' },
        )
        onUnreadChanged()
      }
      if (openDetails && item) {
        const id = item.metadata?.installmentId
        if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
          onOpenInstallment(id)
        else
          onNavigate(
            item.type === 'PAYMENT_SUCCESS' || item.type === 'INSTALLMENT_DUE'
              ? 'Cicilan'
              : 'Pinjaman',
          )
      } else {
        setSuccess(
          item
            ? 'Notifikasi ditandai sudah dibaca.'
            : 'Semua notifikasi ditandai sudah dibaca.',
        )
        setPage(1)
        setRevision((value) => value + 1)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Status baca belum dapat disimpan',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="panel notification-inbox"
      aria-label="Kotak masuk notifikasi"
    >
      <div className="inbox-heading">
        <div>
          <p className="eyebrow">KOTAK MASUK PRIBADI</p>
          <h2>Pemberitahuan Anda</h2>
          <p>
            Ikuti perkembangan pengajuan, cicilan, dan pembayaran tanpa
            melewatkan kabar penting.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || busy}
          onClick={refresh}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Perbarui
        </button>
      </div>
      <div className="inbox-toolbar">
        <div
          className="inbox-filters"
          role="group"
          aria-label="Filter notifikasi"
        >
          {[
            { label: 'Semua', unread: false },
            { label: 'Belum dibaca', unread: true },
          ].map((filter) => (
            <button
              type="button"
              key={filter.label}
              aria-pressed={unreadOnly === filter.unread}
              disabled={busy}
              onClick={() => {
                setUnreadOnly(filter.unread)
                setPage(1)
                setLoading(true)
                setRevision((value) => value + 1)
                setSuccess('')
              }}
            >
              {filter.label}
              {filter.unread && data && <span>{data.unreadCount}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mark-all-button"
          disabled={busy || loading || !data?.unreadCount}
          onClick={() => markRead()}
        >
          <CheckCheck size={17} aria-hidden="true" />
          Tandai semua dibaca
        </button>
      </div>
      {error && <Feedback tone="error">{error}</Feedback>}
      {success && (
        <Feedback tone="success" onClose={() => setSuccess('')}>
          {success}
        </Feedback>
      )}
      {loading ? (
        <p className="empty" role="status">
          Memuat pemberitahuan...
        </p>
      ) : (
        data && (
          <>
            {data.items.length === 0 ? (
              <div className="inbox-empty">
                <BellOff size={34} aria-hidden="true" />
                <h3>
                  {unreadOnly
                    ? 'Semua sudah terbaca'
                    : page > 1
                      ? 'Tidak ada notifikasi pada halaman ini'
                      : 'Belum ada pemberitahuan'}
                </h3>
                <p>
                  {unreadOnly
                    ? 'Pilih Semua untuk melihat kembali riwayat pemberitahuan.'
                    : 'Kabar baru akan muncul di sini setelah ada aktivitas terkait akun Anda.'}
                </p>
              </div>
            ) : (
              <ul className="inbox-list">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className={`inbox-item${item.isRead ? '' : ' unread'}`}
                  >
                    <span className="inbox-item-icon">
                      <Bell size={18} aria-hidden="true" />
                    </span>
                    <div className="inbox-item-content">
                      <div className="inbox-item-title">
                        <h3>{item.title}</h3>
                        {!item.isRead && (
                          <span className="unread-label">Baru</span>
                        )}
                      </div>
                      <p>
                        {item.message.replace(/https?:\/\/\S+/g, '').trim()}
                      </p>
                      <div className="inbox-item-meta">
                        <span>{item.family?.name ?? 'Dana Keluarga'}</span>
                        <time dateTime={item.createdAt}>
                          {dateTime.format(new Date(item.createdAt))} WIB
                        </time>
                      </div>
                      <div className="inbox-item-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => markRead(item, true)}
                        >
                          Lihat rincian
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                        {!item.isRead && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => markRead(item)}
                          >
                            <Check size={15} aria-hidden="true" />
                            Tandai dibaca
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="inbox-pagination">
              <button
                type="button"
                className="secondary-button"
                disabled={page === 1 || busy}
                onClick={() => {
                  setPage((value) => value - 1)
                  setLoading(true)
                }}
              >
                Sebelumnya
              </button>
              <span>
                Halaman {page} · {data.total} pemberitahuan
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={page * 20 >= data.total || busy}
                onClick={() => {
                  setPage((value) => value + 1)
                  setLoading(true)
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
