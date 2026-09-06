const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const accessToken = localStorage.getItem('dana_access_token')
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options?.headers ?? {}) },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Permintaan gagal diproses')
  return payload as T
}
