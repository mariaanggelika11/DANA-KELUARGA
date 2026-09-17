import { useEffect, useState } from 'react'
import { api } from '../../lib/api-client'
import { Feedback } from '../../components/Feedback'
import type { SessionUser } from '../../types/navigation'
import './approvals.css'

type Request = {
  id: string
  referenceId: string
  amount: string
  status: string
  currentStep: number
  submittedAt: string
  maker: { id: string; name: string }
  policy: { version: number }
  loan: { purpose: string } | null
  steps: {
    sequence: number
    permission: string
    assignedUserId: string
    status: string
    assignedUser: { name: string }
    actedAt: string | null
  }[]
  actions: {
    id: string
    action: string
    step: number
    notes: string | null
    actedAt: string
    actor: { name: string }
  }[]
}
const statusLabels: Record<string, string> = {
  PENDING_APPROVAL: 'Menunggu approval',
  PENDING_RELEASE: 'Menunggu pencairan',
  RELEASED: 'Dicairkan',
  REJECTED: 'Ditolak',
  RETURNED: 'Dikembalikan untuk diperbaiki',
  CANCELLED: 'Dibatalkan',
  WAITING: 'Menunggu',
  APPROVED: 'Disetujui',
}
export function ApprovalInbox({
  user,
  onChanged,
  requestId,
}: {
  user: SessionUser
  onChanged: () => void
  requestId: string | null
}) {
  const [tab, setTab] = useState(requestId ? 'all' : 'mine')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Request[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Request | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<{ data: { items: Request[]; total: number } }>(
      `/approvals?tab=${tab}&page=${page}`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setItems(data.items)
          setTotal(data.total)
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Tugas gagal dimuat')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [tab, page, revision, user.familyId])
  useEffect(() => {
    if (!requestId) return
    const controller = new AbortController()
    api<{ data: Request }>(`/approvals/${encodeURIComponent(requestId)}`, {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) setSelected(data)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : 'Rincian tidak dapat dibuka',
          )
      })
    return () => controller.abort()
  }, [requestId, user.familyId])
  async function act(action: string) {
    if (!selected || busy) return
    if (
      (action === 'reject' || action === 'return') &&
      notes.trim().length < 3
    ) {
      setError('Tuliskan alasan minimal tiga karakter.')
      return
    }
    if (
      action === 'release' &&
      !window.confirm(
        'Pastikan transfer dana sudah dilakukan sesuai prosedur keluarga. Catat pencairan sekarang?',
      )
    )
      return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await api<{ data: Request }>(
        `/approvals/${selected.id}/${action}`,
        { method: 'POST', body: JSON.stringify({ notes: notes || undefined }) },
      )
      setSelected(result.data)
      setNotes('')
      setSuccess('Tindakan berhasil dicatat.')
      setRevision((value) => value + 1)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tindakan gagal')
    } finally {
      setBusy(false)
    }
  }
  const current = selected?.steps.find(
    (item) => item.sequence === selected.currentStep,
  )
  const actionable =
    current?.assignedUserId === user.id &&
    current.status === 'WAITING' &&
    ['PENDING_APPROVAL', 'PENDING_RELEASE'].includes(selected?.status ?? '')
  return (
    <section className="approval-page">
      <section className="panel">
        <div className="approval-section-heading">
          <h2>Tugas Persetujuan</h2>
          <button
            className="secondary-button"
            disabled={busy || loading}
            onClick={() => {
              setError('')
              setSelected(null)
              setLoading(true)
              setRevision((value) => value + 1)
            }}
          >
            Perbarui
          </button>
        </div>
        <div className="approval-tabs">
          {[
            ['mine', 'Menunggu Saya'],
            ['processed', 'Sudah Diproses'],
            ['all', 'Semua'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              disabled={busy}
              onClick={() => {
                setTab(value)
                setPage(1)
                setSelected(null)
                setError('')
                setSuccess('')
                setLoading(true)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {error && <Feedback tone="error">{error}</Feedback>}
        {success && <Feedback tone="success">{success}</Feedback>}
        {loading ? (
          <p role="status">Memuat tugas...</p>
        ) : items.length === 0 ? (
          <p>Belum ada pengajuan pada daftar ini.</p>
        ) : (
          <div className="approval-request-list">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={busy}
                onClick={() => {
                  setSelected(item)
                  setNotes('')
                  setError('')
                  setSuccess('')
                }}
              >
                <strong>
                  {item.maker.name} ·{' '}
                  {new Intl.NumberFormat('id-ID', {
                    style: 'currency',
                    currency: 'IDR',
                    maximumFractionDigits: 0,
                  }).format(Number(item.amount))}
                </strong>
                <span>{item.loan?.purpose}</span>
                <small>
                  {statusLabels[item.status]} · Tahap {item.currentStep} ·
                  Hirarki v{item.policy.version}
                </small>
              </button>
            ))}
          </div>
        )}
        <div className="workflow-actions">
          <button
            className="secondary-button"
            disabled={page <= 1 || loading || busy}
            onClick={() => {
              setPage((value) => value - 1)
              setLoading(true)
            }}
          >
            Sebelumnya
          </button>
          <span>
            Halaman {page} · {total} pengajuan
          </span>
          <button
            className="secondary-button"
            disabled={page * 20 >= total || loading || busy}
            onClick={() => {
              setPage((value) => value + 1)
              setLoading(true)
            }}
          >
            Berikutnya
          </button>
        </div>
      </section>
      {selected && (
        <section className="panel approval-detail">
          <h2>Detail pengajuan {selected.maker.name}</h2>
          <p>
            {selected.loan?.purpose} · {statusLabels[selected.status]}
          </p>
          <ol className="approval-timeline">
            {selected.steps.map((step) => (
              <li key={step.sequence}>
                <strong>
                  {step.sequence}. {step.assignedUser.name}
                </strong>
                <span>
                  {step.permission === 'RELEASER' ? 'Releaser' : 'Approver'} ·{' '}
                  {statusLabels[step.status] ?? step.status}
                </span>
                {step.actedAt && (
                  <small>
                    {new Date(step.actedAt).toLocaleString('id-ID')}
                  </small>
                )}
              </li>
            ))}
          </ol>
          {actionable && (
            <div className="approval-action-area">
              <label>
                Catatan / alasan
                <textarea
                  value={notes}
                  maxLength={500}
                  disabled={busy}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Alasan wajib untuk menolak atau mengembalikan"
                />
              </label>
              <div className="workflow-actions">
                {current.permission === 'APPROVER' ? (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => act('approve')}
                    >
                      Setujui tahap ini
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => act('reject')}
                    >
                      Tolak
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => act('return')}
                    >
                      Kembalikan
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => act('release')}
                  >
                    Catat pencairan
                  </button>
                )}
              </div>
            </div>
          )}
          <h3>Riwayat tindakan</h3>
          <ul className="approval-history">
            {selected.actions.map((action) => (
              <li key={action.id}>
                <strong>
                  {action.actor.name} ·{' '}
                  {{
                    SUBMIT: 'Diajukan',
                    APPROVE: 'Disetujui',
                    REJECT: 'Ditolak',
                    RETURN: 'Dikembalikan',
                    RELEASE: 'Dicairkan',
                    CANCEL: 'Dibatalkan',
                  }[action.action] ?? action.action}
                </strong>
                <span>
                  {new Date(action.actedAt).toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                  })}{' '}
                  WIB
                </span>
                {action.notes && <p>{action.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
