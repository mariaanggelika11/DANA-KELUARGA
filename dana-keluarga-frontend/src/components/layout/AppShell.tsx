import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Bell, Menu } from 'lucide-react'
import { AccountMenu } from './AccountMenu'
import { Sidebar } from './Sidebar'
import type { AppPage, SessionUser } from '../../types/navigation'
import './Layout.css'

const mobileQuery = '(max-width: 850px)'
const subscribeViewport = (callback: () => void) => {
  const media = window.matchMedia(mobileQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
type Props = {
  user: SessionUser
  active: AppPage
  unpaidCount: number
  unreadCount: number | null
  notificationError: boolean
  onNavigate: (page: AppPage) => void
  onLogout: () => Promise<void>
  children: ReactNode
}

export function AppShell({
  user,
  active,
  unpaidCount,
  unreadCount,
  notificationError,
  onNavigate,
  onLogout,
  children,
}: Props) {
  const mobile = useSyncExternalStore(
    subscribeViewport,
    () => window.matchMedia(mobileQuery).matches,
    () => false,
  )
  const [desktopOpen, setDesktopOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const open = mobile ? mobileOpen : desktopOpen
  const sidebar = useRef<HTMLElement>(null)
  const hamburger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLElement>(null)
  function navigate(page: AppPage) {
    onNavigate(page)
    setMobileOpen(false)
    content.current?.focus()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  useEffect(() => {
    if (!mobile || !mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        hamburger.current?.focus()
      }
      if (event.key === 'Tab') {
        const controls = [
          hamburger.current,
          ...Array.from(
            sidebar.current?.querySelectorAll<HTMLButtonElement>('button') ??
              [],
          ),
        ].filter((item): item is HTMLButtonElement => Boolean(item))
        const first = controls[0],
          last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [mobile, mobileOpen])
  return (
    <div className="app-shell app-layout">
      <a
        className="skip-content"
        href="#main-content"
        onClick={() => setMobileOpen(false)}
      >
        Lewati navigasi
      </a>
      <header className="app-topbar">
        <div className="topbar-brand">
          <button
            ref={hamburger}
            type="button"
            className="hamburger-button"
            aria-label={open ? 'Tutup navigasi' : 'Buka navigasi'}
            aria-expanded={open}
            aria-controls="app-sidebar"
            onClick={() =>
              mobile
                ? setMobileOpen((value) => !value)
                : setDesktopOpen((value) => !value)
            }
          >
            <Menu size={23} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="brand-link"
            onClick={() => navigate('Ringkasan')}
            aria-label="Dana Keluarga, buka ringkasan"
          >
            <img src="/logo-mark.svg" alt="" />
            <span>
              Dana <i>Keluarga</i>
            </span>
          </button>
        </div>
        <div className="topbar-actions" inert={mobile && mobileOpen}>
          <button
            type="button"
            className={`notification-trigger${active === 'Notifikasi' ? ' selected' : ''}`}
            onClick={() => navigate('Notifikasi')}
            aria-label={
              notificationError
                ? 'Buka notifikasi; jumlah belum dapat diperbarui'
                : unreadCount === null
                  ? 'Buka notifikasi'
                  : `Buka notifikasi, ${unreadCount} belum dibaca`
            }
            title={
              notificationError
                ? 'Jumlah notifikasi belum dapat diperbarui'
                : 'Notifikasi'
            }
          >
            <Bell size={21} aria-hidden="true" />
            {!notificationError && unreadCount !== null && unreadCount > 0 && (
              <span className="notification-count" aria-hidden="true">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            {notificationError && (
              <span className="notification-unavailable" aria-hidden="true">
                !
              </span>
            )}
          </button>
          <AccountMenu user={user} onNavigate={navigate} onLogout={onLogout} />
        </div>
      </header>
      <div className="layout-body">
        {mobile && mobileOpen && (
          <div
            className="sidebar-backdrop"
            aria-hidden="true"
            onClick={() => {
              setMobileOpen(false)
              hamburger.current?.focus()
            }}
          />
        )}
        {open && (
          <aside
            ref={sidebar}
            id="app-sidebar"
            className="app-sidebar"
            aria-label="Menu aplikasi"
          >
            <Sidebar
              user={user}
              active={active}
              unpaidCount={unpaidCount}
              unreadCount={notificationError ? null : unreadCount}
              onNavigate={navigate}
            />
          </aside>
        )}
        <main
          ref={content}
          id="main-content"
          className="content app-content"
          tabIndex={-1}
          inert={mobile && mobileOpen}
        >
          <div className="page-breadcrumb">
            Ruang bersama <span>/</span> <strong>{active}</strong>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
