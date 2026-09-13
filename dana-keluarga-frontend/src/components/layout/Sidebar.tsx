import {
  Bell,
  BookOpen,
  CalendarClock,
  ChevronRight,
  HandCoins,
  LayoutDashboard,
  Settings,
  Users,
  WalletCards,
} from 'lucide-react'
import { type AppPage, type SessionUser } from '../../types/navigation'

type Props = {
  user: SessionUser
  active: AppPage
  unpaidCount: number
  unreadCount: number | null
  onNavigate: (page: AppPage) => void
}
const mainItems = [
  { label: 'Ringkasan', icon: LayoutDashboard },
  { label: 'Kas', icon: WalletCards },
  { label: 'Pinjaman', icon: HandCoins },
  { label: 'Cicilan', icon: CalendarClock },
  { label: 'Anggota', icon: Users },
] as const
const secondaryItems = [
  { label: 'Notifikasi', icon: Bell },
  { label: 'Pengaturan', icon: Settings },
] as const

export function Sidebar({
  user,
  active,
  unpaidCount,
  unreadCount,
  onNavigate,
}: Props) {
  return (
    <>
      <div className="sidebar-family">
        <span className="avatar coral" aria-hidden="true">
          {user.systemRole === 'SUPER_ADMIN'
            ? 'SA'
            : (user.familyName?.slice(0, 1) ?? 'K')}
        </span>
        <div>
          <strong>
            {user.systemRole === 'SUPER_ADMIN'
              ? 'Administrasi global'
              : (user.familyName ?? 'Ruang keluarga')}
          </strong>
          <small>
            {user.systemRole === 'SUPER_ADMIN'
              ? 'Seluruh keluarga'
              : 'Ruang dana bersama'}
          </small>
        </div>
      </div>
      <nav aria-label="Navigasi utama">
        <p className="sidebar-label">MENU UTAMA</p>
        {mainItems.map(({ label, icon: Icon }) => (
          <button
            type="button"
            className={`nav-item${active === label ? ' active' : ''}`}
            aria-current={active === label ? 'page' : undefined}
            key={label}
            onClick={() => onNavigate(label)}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
            {label === 'Cicilan' && unpaidCount > 0 && (
              <span
                className="nav-count"
                aria-label={`${unpaidCount} cicilan belum lunas`}
              >
                {unpaidCount}
              </span>
            )}
          </button>
        ))}
        <p className="sidebar-label sidebar-secondary">LAINNYA</p>
        {secondaryItems.map(({ label, icon: Icon }) => (
          <button
            type="button"
            className={`nav-item${active === label ? ' active' : ''}`}
            aria-current={active === label ? 'page' : undefined}
            key={label}
            onClick={() => onNavigate(label)}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
            {label === 'Notifikasi' &&
              unreadCount !== null &&
              unreadCount > 0 && (
                <span className="nav-count">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
          </button>
        ))}
      </nav>
      <button
        type="button"
        className={`sidebar-help${active === 'Panduan' ? ' selected' : ''}`}
        onClick={() => onNavigate('Panduan')}
      >
        <BookOpen size={21} aria-hidden="true" />
        <span>
          <strong>Butuh bantuan?</strong>
          <small>Baca panduan aplikasi</small>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </>
  )
}
