import { useState } from 'react'
import { api } from '../../lib/api-client'
import { Feedback } from '../Feedback'
import type { SessionUser } from '../../types/navigation'

export function FamilySwitcher({ user }: { user: SessionUser }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (
    user.systemRole === 'SUPER_ADMIN' ||
    !user.families ||
    user.families.length < 2
  )
    return null
  async function switchFamily(familyId: string) {
    if (busy || familyId === user.familyId) return
    if (
      !window.confirm(
        'Pindah keluarga? Isian yang belum disimpan akan ditinggalkan.',
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const { data } = await api<{ data: { accessToken: string } }>(
        '/auth/active-family',
        { method: 'POST', body: JSON.stringify({ familyId }) },
      )
      localStorage.setItem('dana_access_token', data.accessToken)
      // Reload drops all cached transaction/form state from the previous family.
      window.location.assign('?view=summary')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Keluarga belum dapat diganti',
      )
      setBusy(false)
    }
  }
  return (
    <section className="family-context">
      <label>
        Keluarga aktif{' '}
        <select
          value={user.familyId ?? ''}
          disabled={busy}
          onChange={(event) => void switchFamily(event.target.value)}
        >
          {user.families.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}
            </option>
          ))}
        </select>
      </label>
      {busy && <p role="status">Memindahkan ruang keluarga...</p>}
      {error && <Feedback tone="error">{error}</Feedback>}
    </section>
  )
}
