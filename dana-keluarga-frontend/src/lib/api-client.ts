const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const accessToken = localStorage.getItem('dana_access_token')
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options?.headers ?? {}) },
    })
  } catch (error) {
    if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet, lalu coba lagi.', 0, 'NETWORK_ERROR')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback: Record<number, string> = {
      400: 'Periksa kembali isian Anda.',
      401: path === '/auth/login' ? 'Email atau password tidak sesuai. Periksa kembali keduanya.' : 'Sesi login telah berakhir. Silakan masuk kembali.',
      403: 'Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.',
      404: 'Data tidak ditemukan atau tidak dapat diakses.',
      409: 'Data telah berubah atau sudah diproses. Perbarui halaman.',
      429: 'Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi.',
      500: 'Server mengalami kendala. Silakan coba lagi beberapa saat.',
      503: 'Layanan belum tersedia. Silakan coba lagi nanti.',
    }
    const serverMessage = typeof payload?.error?.message === 'string' ? payload.error.message : undefined
    const message = response.status === 403 || response.status === 429 || (response.status === 401 && path === '/auth/login')
      ? fallback[response.status] : serverMessage ?? fallback[response.status] ?? 'Permintaan gagal diproses. Silakan coba lagi.'
    throw new ApiError(message, response.status, payload?.error?.code)
  }
  if (payload === null) throw new ApiError('Respons server tidak dapat dibaca. Silakan coba lagi.', response.status, 'INVALID_RESPONSE')
  return payload as T
}
