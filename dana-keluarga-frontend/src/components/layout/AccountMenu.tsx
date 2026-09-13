import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react'
import {
  roleLabel,
  type AppPage,
  type SessionUser,
} from '../../types/navigation'

type Props = {
  user: SessionUser
  onNavigate: (page: AppPage) => void
  onLogout: () => Promise<void>
}

export function AccountMenu({ user, onNavigate, onLogout }: Props) {
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div
      className="top-account"
      ref={container}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-controls="account-disclosure"
        aria-label={`Menu akun ${user.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar indigo" aria-hidden="true">
          {user.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="account-trigger-copy">
          <strong>{user.name}</strong>
          <small>{roleLabel(user)}</small>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={open ? 'rotated' : ''}
        />
      </button>
      {open && (
        <div id="account-disclosure" className="account-disclosure">
          <div className="account-details">
            <UserRound size={20} aria-hidden="true" />
            <div>
              <strong>{user.name}</strong>
              <span>{user.email || user.phone}</span>
              <small>
                {roleLabel(user)} · {user.familyName || 'Administrasi global'}
              </small>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onNavigate('Pengaturan')
            }}
          >
            <Settings size={17} aria-hidden="true" />
            Pengaturan notifikasi
          </button>
          <button
            type="button"
            className="account-logout"
            disabled={loggingOut}
            onClick={async () => {
              if (loggingOut) return
              setLoggingOut(true)
              try {
                await onLogout()
              } finally {
                setLoggingOut(false)
                setOpen(false)
              }
            }}
          >
            <LogOut size={17} aria-hidden="true" />
            {loggingOut ? 'Sedang keluar...' : 'Keluar dari akun'}
          </button>
        </div>
      )}
    </div>
  )
}
