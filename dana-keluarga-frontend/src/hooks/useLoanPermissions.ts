import { useEffect, useState } from 'react'
import { api } from '../lib/api-client'
import type { SessionUser } from '../types/navigation'

type Permissions = { configured: boolean; canCreateLoan: boolean }
export function useLoanPermissions(user: SessionUser | null, visible: boolean) {
  const [data, setData] = useState<Permissions | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!visible || user?.systemRole !== 'USER') return
    const controller = new AbortController()
    api<{ data: Permissions }>('/approvals/permissions', {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setData(data)
          setError('')
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setData(null)
          setError(
            err instanceof Error
              ? err.message
              : 'Hak pengajuan belum dapat diperiksa',
          )
        }
      })
    return () => controller.abort()
  }, [user?.id, user?.familyId, user?.systemRole, visible])
  return { data, error }
}
