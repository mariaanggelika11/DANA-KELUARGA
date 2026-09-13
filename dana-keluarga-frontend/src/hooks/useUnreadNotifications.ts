import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api-client'

export function useUnreadNotifications(userId?: string) {
  const [snapshot, setSnapshot] = useState<{
    userId: string
    count: number
  } | null>(null)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)
  const requestVersion = useRef(0)
  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    async function load() {
      if (document.hidden) return
      const current = ++requestVersion.current
      try {
        const result = await api<{ data: { unreadCount: number } }>(
          '/notifications/inbox/unread-count',
          { signal: controller.signal },
        )
        if (!controller.signal.aborted && current === requestVersion.current) {
          setSnapshot({ userId: userId!, count: result.data.unreadCount })
          setError(false)
        }
      } catch {
        if (!controller.signal.aborted && current === requestVersion.current)
          setError(true)
      }
    }
    void load()
    const timer = window.setInterval(load, 30000)
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [userId, version])
  return {
    count: userId && snapshot?.userId === userId ? snapshot.count : null,
    error,
    refresh,
  }
}
