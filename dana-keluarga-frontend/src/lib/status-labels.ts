export const loanStatus: Record<string, string> = {
  PENDING: "Menunggu persetujuan",
  APPROVED: "Disetujui, menunggu pencairan",
  ACTIVE: "Berjalan",
  REJECTED: "Ditolak",
  PAID_OFF: "Lunas",
  CANCELLED: "Dibatalkan",
};
export const installmentStatus: Record<string, string> = {
  PENDING_REVIEW: "Menunggu pemeriksaan",
  UNPAID: "Belum dibayar",
  PARTIAL: "Sebagian dibayar",
  PAID: "Lunas",
  OVERDUE: "Terlambat",
};
export const ledgerLabels: Record<string, string> = {
  CONTRIBUTION: "Setoran anggota",
  CONTRIBUTION_REVERSAL: "Koreksi setoran",
  WITHDRAWAL: "Tarikan kontribusi",
  LOAN_DISBURSEMENT: "Pencairan pinjaman",
  LOAN_REPAYMENT: "Pengembalian pinjaman",
  OTHER_INCOME: "Pemasukan umum",
  EXPENSE: "Pengeluaran umum",
  INITIAL_BALANCE: "Saldo awal",
  ADJUSTMENT: "Penyesuaian",
  REVERSAL: "Pembalik transaksi",
};
