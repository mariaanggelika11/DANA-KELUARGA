export type AppPage =
  | 'Ringkasan'
  | 'Kas'
  | 'Pinjaman'
  | 'Cicilan'
  | 'Anggota'
  | 'Notifikasi'
  | 'Pengaturan'
  | 'Panduan'
  | 'Setup Hirarki'
  | 'Persetujuan'
export type SessionUser = {
  id: string
  name: string
  email: string | null
  phone: string
  systemRole: string
  familyRole?: string
  familyId?: string
  families?: { id: string; name: string; role: string }[]
  familyName?: string
}
export function roleLabel(user: SessionUser) {
  if (user.systemRole === 'SUPER_ADMIN') return 'Super Admin'
  if (user.familyRole === 'ADMIN') return 'Admin keluarga'
  if (user.familyRole === 'TREASURER') return 'Bendahara'
  return 'Anggota'
}

export const pageQueries: Record<AppPage, string> = {
  Ringkasan: 'summary',
  Kas: 'ledger',
  Pinjaman: 'loans',
  Cicilan: 'installments',
  Anggota: 'members',
  Notifikasi: 'notifications',
  Pengaturan: 'settings',
  Panduan: 'help',
  'Setup Hirarki': 'hierarchy',
  Persetujuan: 'approvals',
}
export function initialPage(): AppPage {
  const query = new URLSearchParams(window.location.search)
  if (query.has('installment')) return 'Cicilan'
  return (
    (Object.entries(pageQueries).find(
      ([, value]) => value === query.get('view'),
    )?.[0] as AppPage | undefined) ?? 'Ringkasan'
  )
}
