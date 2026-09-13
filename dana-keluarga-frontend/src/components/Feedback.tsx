import { Ban, CircleAlert, CircleCheck, CircleX, Info, X } from 'lucide-react'
import { Children, isValidElement, type ReactNode } from 'react'

export type FeedbackTone = 'success' | 'warning' | 'error' | 'info'
const labels = { success: 'Berhasil', warning: 'Perhatian', error: 'Tidak berhasil', info: 'Informasi' }
const icons = { success: CircleCheck, warning: CircleAlert, error: CircleX, info: Info }

function messageText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? messageText(child.props.children) : '').join(' ')
}

export function Feedback({ tone = 'info', title, children, onClose, floating = false }: {
  tone?: FeedbackTone; title?: string; children: ReactNode; onClose?: () => void; floating?: boolean
}) {
  const text = messageText(children)
  if (tone === 'error' && /terlalu banyak percobaan/i.test(text)) tone = 'warning'
  const forbidden = tone === 'error' && /akses ditolak|tidak memiliki akses|tidak memiliki izin|hanya .*pengelola/i.test(text)
  const Icon = forbidden ? Ban : icons[tone]
  return <div className={`feedback feedback-${tone}${floating ? ' feedback-floating' : ''}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} aria-atomic="true">
    <Icon className="feedback-icon" size={20} aria-hidden="true" />
    <div className="feedback-content"><strong>{title ?? (forbidden ? 'Akses ditolak' : labels[tone])}</strong><div>{children}</div></div>
    {onClose && <button type="button" className="feedback-close" onClick={onClose} aria-label="Tutup pemberitahuan"><X size={18} aria-hidden="true" /></button>}
  </div>
}
