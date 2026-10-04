import { FundTransactionDialog } from "./features/cash/FundTransactionDialog";
import { LoadingState } from "./components/LoadingState";
import { EditMemberRole } from "./features/members/EditMemberRole";
import { SearchableSelect } from "./components/SearchableSelect";
import { FamilyCash } from "./features/cash/FamilyCash";
import { CurrencyInput } from "./components/CurrencyInput";
import { currencyError } from "./lib/currency";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronDown,
  Pencil,
  Users,
  HandCoins,
  ArrowUpRight,
  ArrowDownRight,
  UserPlus,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import "./App.css";
import { HierarchySetup } from "./features/approvals/HierarchySetup";
import { ApprovalInbox } from "./features/approvals/ApprovalInbox";
import { Feedback } from "./components/Feedback";
import { PasswordInput } from "./components/PasswordInput";
import { ValidatedForm } from "./components/ValidatedForm";
import { LoaderCircle, LogIn } from "lucide-react";
import { EmailSettings } from "./components/EmailSettings";
import { NotificationInbox } from "./components/notifications/NotificationInbox";
import { Modal } from "./components/Modal";
import { RegistrationDialog } from "./features/members/RegistrationDialog";
import { useConfirmation } from "./hooks/useConfirmation";
import { FamilySwitcher } from "./components/layout/FamilySwitcher";
import { AppShell } from "./components/layout/AppShell";
import { HelpGuide } from "./components/HelpGuide";
import { useLoanPermissions } from "./hooks/useLoanPermissions";
import { useUnreadNotifications } from "./hooks/useUnreadNotifications";
import {
  initialPage,
  pageQueries,
  type AppPage,
  type SessionUser,
} from "./types/navigation";
import { InstallmentPayment } from "./components/InstallmentPayment";
import { rupiah, date } from "./lib/format";
import { api, ApiError } from "./lib/api-client";

const loanStatus: Record<string, string> = {
  PENDING: "Menunggu persetujuan",
  APPROVED: "Disetujui, menunggu pencairan",
  ACTIVE: "Berjalan",
  REJECTED: "Ditolak",
  PAID_OFF: "Lunas",
  CANCELLED: "Dibatalkan",
};
const installmentStatus: Record<string, string> = {
  UNPAID: "Belum dibayar",
  PARTIAL: "Sebagian dibayar",
  PAID: "Lunas",
  OVERDUE: "Terlambat",
};
type Summary = {
  balance: string;
  loans: string;
  installments: string;
  members: number;
};
type Activity = {
  id: string;
  title: string;
  detail: string;
  amount: string | number;
  direction: "IN" | "OUT";
  createdBy?: { name: string };
};
type Installment = {
  id: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: string | number;
  paidAmount: string | number;
  remainingAmount: string | number;
  status: string;
};
type Loan = {
  id: string;
  principalAmount: string | number;
  tenorMonths: number;
  purpose: string;
  status: string;
  requestedAt: string;
  rejectionReason?: string | null;
  approvedAt?: string | null;
  approvedBy?: { id: string; name: string } | null;
  rejectedBy?: { id: string; name: string } | null;
  borrower: { id: string; name: string; phone: string };
  installments: Installment[];
  approvalRequest?: { id: string; currentStep: number; status: string } | null;
};
type User = SessionUser;
type Member = {
  family?: { id: string; name: string; code: string };
  id: string;
  role: string;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    systemRole: string;
  };
};
type Family = { id: string; name: string; code: string };
type LedgerEntry = Activity & {
  occurredAt: string;
  description: string;
  type: string;
  referenceId?: string;
  balanceBefore?: string | null;
  balanceAfter?: string | null;
};
const ledgerLabels: Record<string, string> = {
  CONTRIBUTION: "Setoran anggota",
  WITHDRAWAL: "Tarikan kontribusi",
  LOAN_DISBURSEMENT: "Pencairan pinjaman",
  LOAN_REPAYMENT: "Pengembalian pinjaman",
  OTHER_INCOME: "Pemasukan umum",
  EXPENSE: "Pengeluaran umum",
  INITIAL_BALANCE: "Saldo awal",
  ADJUSTMENT: "Penyesuaian",
  REVERSAL: "Pembalik transaksi",
};
type Notice = { message: string; tone: "success" | "warning" | "error" };

function App() {
  const confirm = useConfirmation();
  const [user, setUser] = useState<User | null>(null);
  const unreadNotifications = useUnreadNotifications(user?.id);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginErrorCode, setLoginErrorCode] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(
    Boolean(localStorage.getItem("dana_access_token")),
  );
  const memberLoadSequence = useRef(0);
  const [active, setActive] = useState<AppPage>(initialPage);
  const loanPermissions = useLoanPermissions(
    user,
    active === "Pinjaman" || active === "Kas",
  );
  const [hierarchyDirty, setHierarchyDirty] = useState(false);
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("request"),
  );
  const openApproval = (id: string) => {
    setApprovalRequestId(id);
    setActive("Persetujuan");
    window.history.pushState(
      null,
      "",
      `?view=approvals&request=${encodeURIComponent(id)}`,
    );
  };
  const [paymentInstallmentId, setPaymentInstallmentId] = useState<
    string | null
  >(() => new URLSearchParams(window.location.search).get("installment"));
  const openPayment = (id: string) => {
    setPaymentInstallmentId(id);
    setActive("Cicilan");
    window.history.pushState(
      null,
      "",
      `?installment=${encodeURIComponent(id)}`,
    );
  };
  const closePayment = () => {
    setPaymentInstallmentId(null);
    window.history.pushState(null, "", "?view=installments");
  };
  const navigate = async (page: AppPage) => {
    if (
      hierarchyDirty &&
      page !== active &&
      !(await confirm({
        title: "Tinggalkan halaman?",
        message: "Perubahan hirarki belum disimpan dan akan hilang.",
        confirmLabel: "Tinggalkan halaman",
        destructive: true,
      }))
    )
      return;
    setApprovalRequestId(null);
    if (
      user?.systemRole === "SUPER_ADMIN" &&
      ["Ringkasan", "Kas", "Pinjaman", "Cicilan", "Persetujuan"].includes(page)
    )
      page = "Setup Hirarki";
    setActive(page);
    setPaymentInstallmentId(null);
    window.history.pushState(null, "", `?view=${pageQueries[page]}`);
  };
  const [cashRevision, setCashRevision] = useState(0);
  const refreshFinancials = () => {
    setCashRevision((value) => value + 1);
    unreadNotifications.refresh();
    void loadLoans();
    void loadLedger();
    api<{ data: Summary }>("/dashboard/summary")
      .then((payload) => {
        setSummary(payload.data);
        setSummaryError("");
      })
      .catch((error: unknown) =>
        setSummaryError(
          error instanceof Error
            ? error.message
            : "Ringkasan belum dapat dimuat.",
        ),
      );
  };
  const [summaryError, setSummaryError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const ledgerKey = useRef(crypto.randomUUID());
  const [ledgerFormOpen, setLedgerFormOpen] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({
    direction: "IN",
    amount: "",
    description: "",
  });
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loansError, setLoansError] = useState("");
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState("");
  const [families, setFamilies] = useState<Family[]>([]);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [loanFormOpen, setLoanFormOpen] = useState(false);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [memberFamilyId, setMemberFamilyId] = useState("");
  const [familiesLoading, setFamiliesLoading] = useState(true);
  const [familiesError, setFamiliesError] = useState("");
  useEffect(() => {
    const restoreLocation = () => {
      if (hierarchyDirty) {
        window.history.pushState(null, "", `?view=${pageQueries[active]}`);
        setNoticeState({
          message:
            "Simpan perubahan hirarki atau gunakan menu aplikasi untuk meninggalkan halaman.",
          tone: "warning",
        });
        return;
      }
      let page = initialPage();
      if (
        user?.systemRole === "SUPER_ADMIN" &&
        ["Ringkasan", "Kas", "Pinjaman", "Cicilan", "Persetujuan"].includes(
          page,
        )
      )
        page = "Setup Hirarki";
      setActive(page);
      const query = new URLSearchParams(window.location.search);
      setPaymentInstallmentId(query.get("installment"));
      setApprovalRequestId(query.get("request"));
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [active, hierarchyDirty, user?.systemRole]);
  const setNotice = (message: string | null) =>
    setNoticeState(message ? { message, tone: "success" } : null);
  const showNotice = (message: string, tone: Notice["tone"] = "success") =>
    setNoticeState({ message, tone });
  useEffect(() => {
    if (!notice) return;
    if (notice.tone === "error" || notice.tone === "warning") return;
    const timeout = window.setTimeout(() => setNoticeState(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (localStorage.getItem("dana_access_token"))
      api<{ data: User }>("/auth/me")
        .then((payload) => {
          setUser(payload.data);
          if (
            payload.data.systemRole === "SUPER_ADMIN" &&
            ![
              "Anggota",
              "Notifikasi",
              "Pengaturan",
              "Panduan",
              "Setup Hirarki",
            ].includes(initialPage())
          )
            setActive("Setup Hirarki");
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            localStorage.removeItem("dana_access_token");
            localStorage.removeItem("dana_refresh_token");
          }
          setLoginError(
            error instanceof Error ? error.message : "Sesi belum dapat dimuat.",
          );
        })
        .finally(() => setSessionLoading(false));
  }, []);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setMembers([]);
      setLoans([]);
      setLedger([]);
      setSummary(null);
      setLedgerFormOpen(false);
      setMemberFormOpen(false);
      setLoginError("Sesi Anda telah berakhir. Silakan masuk kembali.");
    };
    window.addEventListener("dana:session-expired", expired);
    return () => window.removeEventListener("dana:session-expired", expired);
  }, []);
  const loadMembers = async (selectedFamily = memberFamilyId) => {
    const sequence = ++memberLoadSequence.current;
    setMembersLoading(true);
    setMembersError("");
    try {
      const result = (
        await api<{ data: Member[] }>(
          `/management/members${user?.systemRole === "SUPER_ADMIN" && selectedFamily ? `?familyId=${encodeURIComponent(selectedFamily)}` : ""}`,
        )
      ).data;
      if (sequence === memberLoadSequence.current) setMembers(result);
    } catch (error) {
      if (sequence === memberLoadSequence.current)
        setMembersError(
          error instanceof Error
            ? error.message
            : "Data anggota tidak dapat dimuat",
        );
    } finally {
      if (sequence === memberLoadSequence.current) setMembersLoading(false);
    }
  };
  const loadLoans = async () => {
    setLoansLoading(true);
    setLoansError("");
    try {
      setLoans((await api<{ data: Loan[] }>("/loans")).data);
    } catch (error) {
      setLoansError(
        error instanceof Error
          ? error.message
          : "Data pinjaman tidak dapat dimuat",
      );
    } finally {
      setLoansLoading(false);
    }
  };
  const loadLedger = async () => {
    setLedgerLoading(true);
    setLedgerError("");
    try {
      setLedger((await api<{ data: LedgerEntry[] }>("/ledger")).data);
    } catch (error) {
      setLedgerError(
        error instanceof Error
          ? error.message
          : "Catatan kas belum dapat dimuat.",
      );
    } finally {
      setLedgerLoading(false);
    }
  };
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    if (user.systemRole !== "SUPER_ADMIN")
      api<{ data: Summary }>("/dashboard/summary", options)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setSummary(payload.data);
            setSummaryError("");
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setSummaryError(
              error instanceof Error
                ? error.message
                : "Ringkasan belum dapat dimuat.",
            );
        });
    if (user.systemRole !== "SUPER_ADMIN")
      api<{ data: Loan[] }>("/loans", options)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setLoans(payload.data);
            setLoansError("");
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setLoansError(
              error instanceof Error ? error.message : "Pinjaman gagal dimuat",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoansLoading(false);
        });
    const memberSequence = ++memberLoadSequence.current;
    api<{ data: Member[] }>("/management/members", options)
      .then((payload) => {
        if (
          !controller.signal.aborted &&
          memberSequence === memberLoadSequence.current
        ) {
          setMembers(payload.data);
          setMembersError("");
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          memberSequence === memberLoadSequence.current
        )
          setMembersError(
            error instanceof Error ? error.message : "Anggota gagal dimuat",
          );
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          memberSequence === memberLoadSequence.current
        )
          setMembersLoading(false);
      });
    if (user.systemRole !== "SUPER_ADMIN")
      api<{ data: LedgerEntry[] }>("/ledger", options)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setLedger(payload.data);
            setLedgerError("");
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setLedgerError(
              error instanceof Error
                ? error.message
                : "Catatan kas belum dapat dimuat.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLedgerLoading(false);
        });
    if (user.systemRole === "SUPER_ADMIN")
      api<{ data: Family[] }>("/management/families", options)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setFamilies(payload.data);
            setFamiliesError("");
          }
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted)
            setFamiliesError(
              err instanceof Error
                ? err.message
                : "Daftar keluarga belum dapat dimuat.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setFamiliesLoading(false);
        });
    return () => controller.abort();
  }, [user]);
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (loginLoading) return;
    setLoginLoading(true);
    setLoginErrorCode("");
    setLoginError("");
    try {
      const payload = await api<{
        data: { accessToken: string; refreshToken: string; user: User };
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password,
        }),
      });
      localStorage.setItem("dana_access_token", payload.data.accessToken);
      localStorage.setItem("dana_refresh_token", payload.data.refreshToken);
      setLoginForm((current) => ({ ...current, password: "" }));
      setUser(payload.data.user);
      if (payload.data.user.systemRole === "SUPER_ADMIN")
        navigate("Setup Hirarki");
    } catch (error) {
      setLoginErrorCode(error instanceof ApiError ? (error.code ?? "") : "");
      setLoginError(error instanceof Error ? error.message : "Login gagal");
    } finally {
      setLoginLoading(false);
    }
  };
  const logout = async () => {
    if (
      hierarchyDirty &&
      !(await confirm({
        title: "Keluar dari akun?",
        message: "Perubahan hirarki belum disimpan dan akan hilang.",
        confirmLabel: "Keluar",
        destructive: true,
      }))
    )
      return;
    const refreshToken = localStorage.getItem("dana_refresh_token");
    await api("/auth/logout", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
    localStorage.removeItem("dana_access_token");
    localStorage.removeItem("dana_refresh_token");
    setUser(null);
    setLoans([]);
    setLedger([]);
    setSummary(null);
    setMembers([]);
    setNotice(null);
    setLedgerFormOpen(false);
    setMemberFormOpen(false);
    setFamilies([]);
    setActive("Ringkasan");
    setPaymentInstallmentId(null);
    setApprovalRequestId(null);
    setMemberFamilyId("");
    window.history.replaceState(null, "", "?view=summary");
  };
  const submitLedger = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    if (currencyError(ledgerForm.amount, true)) {
      showNotice(
        "Nominal harus lebih dari nol dan berupa rupiah utuh.",
        "error",
      );
      return;
    }
    if (
      !(await confirm({
        title: "Simpan catatan kas?",
        message: `${ledgerForm.direction === "IN" ? "Pemasukan" : "Pengeluaran"} ${rupiah(ledgerForm.amount)} akan memengaruhi saldo keluarga. Periksa nominal dan keterangannya.`,
        confirmLabel: "Simpan catatan",
      }))
    )
      return;
    setLoading(true);
    try {
      await api("/ledger", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: ledgerKey.current,
          direction: ledgerForm.direction,
          amount: ledgerForm.amount,
          description: ledgerForm.description,
        }),
      });
      setLedgerFormOpen(false);
      ledgerKey.current = crypto.randomUUID();
      setLedgerForm({ direction: "IN", amount: "", description: "" });
      refreshFinancials();
      showNotice("Catatan kas berhasil disimpan.");
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Catatan kas gagal disimpan",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };
  const unpaidInstallments = loans.reduce(
    (total, loan) =>
      total +
      loan.installments.filter((installment) => installment.status !== "PAID")
        .length,
    0,
  );

  const isSuperAdmin = user?.systemRole === "SUPER_ADMIN";
  const isFamilyAdmin = user?.familyRole === "ADMIN";
  const isTreasurer = user?.familyRole === "TREASURER";
  const canManageMembers = isSuperAdmin || isFamilyAdmin;
  const canManageLoans = !isSuperAdmin && isFamilyAdmin;
  const canRequestLoan =
    user?.systemRole === "USER" && loanPermissions.data?.canCreateLoan === true;
  const canManageLedger = !isSuperAdmin && (isFamilyAdmin || isTreasurer);
  const installmentGroups = loans.reduce<
    Array<{
      borrowerId: string;
      borrowerName: string;
      loans: Loan[];
      installments: Array<{ loan: Loan; installment: Installment }>;
    }>
  >((groups, loan) => {
    const existing = groups.find(
      (group) => group.borrowerId === loan.borrower.id,
    );
    const group = existing ?? {
      borrowerId: loan.borrower.id,
      borrowerName: loan.borrower.name,
      loans: [],
      installments: [],
    };
    if (!existing) groups.push(group);
    group.loans.push(loan);
    loan.installments.forEach((installment) =>
      group.installments.push({ loan, installment }),
    );
    return groups;
  }, []);
  const [expandedBorrowers, setExpandedBorrowers] = useState<string[]>([]);
  const openMemberForm = () => setMemberFormOpen(true);
  if (sessionLoading)
    return (
      <main className="login-page">
        <LoadingState label="Memeriksa sesi Anda..." />
      </main>
    );
  if (!user)
    return (
      <div className="login-page">
        <ValidatedForm
          className="login-card"
          onSubmit={login}
          aria-label="Masuk Dana Keluarga"
          aria-busy={loginLoading}
        >
          <div className="brand">
            <img src="/logo-mark.svg" alt="" />
            Dana <i>Keluarga</i>
          </div>
          <p className="eyebrow">RUANG BERSAMA</p>
          <h1>Selamat datang kembali.</h1>
          <p className="login-copy">
            Masuk untuk melihat kas, pinjaman, dan aktivitas keluarga.
          </p>
          {loginError && (
            <Feedback
              tone={
                loginErrorCode === "AUTH_EMAIL_NOT_REGISTERED"
                  ? "warning"
                  : "error"
              }
              title={
                loginErrorCode === "AUTH_EMAIL_NOT_REGISTERED"
                  ? "Email belum terdaftar"
                  : loginErrorCode === "AUTH_PASSWORD_INCORRECT"
                    ? "Password salah"
                    : loginErrorCode === "AUTH_ACCOUNT_INACTIVE"
                      ? "Akun tidak aktif"
                      : undefined
              }
            >
              {loginError}
            </Feedback>
          )}
          <label htmlFor="login-email">
            Email
            <input
              id="login-email"
              name="Email"
              required
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="nama@contoh.com"
              disabled={loginLoading}
              value={loginForm.email}
              onChange={(event) => {
                setLoginError("");
                setLoginForm({ ...loginForm, email: event.target.value });
              }}
            />
          </label>
          <label htmlFor="login-password">
            Password
            <PasswordInput
              id="login-password"
              name="Password"
              required
              minLength={8}
              autoComplete="current-password"
              placeholder="Masukkan password"
              disabled={loginLoading}
              value={loginForm.password}
              onChange={(event) => {
                setLoginError("");
                setLoginForm({ ...loginForm, password: event.target.value });
              }}
            />
          </label>
          <button className="primary login-submit" disabled={loginLoading}>
            {loginLoading ? (
              <LoaderCircle
                size={18}
                className="loading-spinner"
                aria-hidden="true"
              />
            ) : (
              <LogIn size={18} aria-hidden="true" />
            )}
            {loginLoading ? "Sedang masuk..." : "Masuk"}
          </button>
          <p className="login-help">
            Belum memiliki akun atau lupa password? Hubungi admin keluarga.
          </p>
        </ValidatedForm>
      </div>
    );
  return (
    <AppShell
      key={user.id}
      user={user}
      active={active}
      unpaidCount={unpaidInstallments}
      unreadCount={unreadNotifications.count}
      notificationError={unreadNotifications.error}
      onNavigate={navigate}
      onLogout={logout}
    >
      <FamilySwitcher user={user} />
      <section className="intro">
        <div>
          <p className="date">
            {new Intl.DateTimeFormat("id-ID", {
              dateStyle: "full",
              timeZone: "Asia/Jakarta",
            }).format(new Date())}
          </p>
          <h1>
            {!user.familyId && !isSuperAdmin && (
              <Feedback tone="warning">
                Akun Anda belum memiliki keluarga aktif. Hubungi admin untuk
                memeriksa keanggotaan.
              </Feedback>
            )}
            {active === "Tidak ditemukan" && (
              <Feedback tone="warning" title="Halaman tidak ditemukan">
                Tautan tidak dikenali. Pilih menu di sebelah kiri atau{" "}
                <button
                  className="text-button"
                  onClick={() => navigate("Ringkasan")}
                >
                  buka beranda
                </button>
                .
              </Feedback>
            )}
            {active === "Setup Hirarki"
              ? "Setup hirarki keluarga."
              : active === "Persetujuan"
                ? "Persetujuan berurutan."
                : active === "Panduan"
                  ? "Panduan Dana Keluarga."
                  : active === "Pengaturan"
                    ? "Pengaturan pemberitahuan."
                    : active === "Notifikasi"
                      ? "Pemberitahuan keluarga."
                      : active === "Anggota"
                        ? "Kelola ruang bersama."
                        : active === "Pinjaman"
                          ? canManageLoans
                            ? "Kelola pinjaman."
                            : "Pinjaman saya."
                          : active === "Cicilan"
                            ? "Jadwal cicilan."
                            : `Halo, ${user.name}.`}
          </h1>
          <p>
            {active === "Setup Hirarki"
              ? "Atur petugas dan urutan persetujuan untuk setiap keluarga."
              : active === "Persetujuan"
                ? "Tinjau pengajuan pada tahap yang menjadi tanggung jawab Anda."
                : active === "Panduan"
                  ? "Kenali alur aplikasi dan langkah yang sesuai dengan peran Anda."
                  : active === "Pengaturan"
                    ? "Lihat email penerima dan riwayat pengiriman pemberitahuan."
                    : active === "Notifikasi"
                      ? "Baca kabar terbaru yang terkait dengan akun Anda."
                      : active === "Anggota"
                        ? "Pastikan setiap orang memiliki akses dan peran yang tepat di keluarga ini."
                        : active === "Pinjaman"
                          ? canManageLoans
                            ? "Tinjau pengajuan dan kelola dana keluarga dengan tertib."
                            : "Pantau pengajuan dan kewajiban pinjaman Anda."
                          : active === "Cicilan"
                            ? "Lihat jadwal pembayaran berdasarkan pinjaman yang telah dicairkan."
                            : "Pelan-pelan, yang penting bersama. Ini kabar terbaru ruang dana keluarga."}
          </p>
        </div>
        {active === "Anggota" && canManageMembers && (
          <button className="primary" onClick={openMemberForm}>
            <UserPlus size={17} />
            Tambah anggota
          </button>
        )}
      </section>
      {notice && !ledgerFormOpen && (
        <Feedback tone={notice.tone} floating onClose={() => setNotice(null)}>
          {notice.message}
        </Feedback>
      )}
      {active === "Setup Hirarki" && (isSuperAdmin || isFamilyAdmin) && (
        <HierarchySetup onDirtyChange={setHierarchyDirty} />
      )}
      {active === "Setup Hirarki" && !isSuperAdmin && !isFamilyAdmin && (
        <Feedback tone="warning">
          Hanya Super Admin dan Admin keluarga yang dapat mengatur hirarki.
        </Feedback>
      )}
      {active === "Persetujuan" && !isSuperAdmin && (
        <ApprovalInbox
          requestId={approvalRequestId}
          user={user}
          onChanged={refreshFinancials}
        />
      )}
      {active === "Pinjaman" && (
        <section className="panel loan-list">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">RUANG DANA</p>
              <h2>{canManageLoans ? "Kelola pinjaman" : "Pinjaman saya"}</h2>
              <p className="panel-description">
                {canManageLoans
                  ? "Tinjau pengajuan dan kelola pencairan dana keluarga."
                  : "Pantau status pengajuan dan jadwal pengembalian dana Anda."}
              </p>
            </div>
            {canRequestLoan && (
              <button className="primary" onClick={() => setLoanFormOpen(true)}>
                <HandCoins size={15} />
                Ajukan pinjaman
              </button>
            )}
          </div>
          {loanPermissions.error && (
            <Feedback tone="error">{loanPermissions.error}</Feedback>
          )}
          {loanPermissions.data && !loanPermissions.data.canCreateLoan && (
            <Feedback tone="info">
              {!loanPermissions.data.configured
                ? "Hirarki pinjaman belum diatur. Hubungi Admin keluarga atau Super Admin untuk mengisi Setup Hirarki."
                : "Pengajuan hanya tersedia untuk Maker yang tidak menjadi approver atau releaser dalam hirarki ini. Hubungi pengelola untuk penyesuaian petugas."}
            </Feedback>
          )}
          {loansLoading ? (
            <LoadingState label="Memuat data pinjaman..." />
          ) : loansError ? (
            <Feedback tone="error">
              <p>{loansError}</p>
              <button className="secondary-button" onClick={loadLoans}>
                Coba lagi
              </button>
            </Feedback>
          ) : loans.length === 0 ? (
            <p className="empty">Belum ada data pinjaman.</p>
          ) : (
            loans.map((loan) => (
              <div className="loan-row" key={loan.id}>
                <div>
                  <strong>{loan.borrower.name}</strong>
                  <small>
                    {loan.purpose} · {loan.tenorMonths} bulan · Diajukan{" "}
                    {date.format(new Date(loan.requestedAt))}
                  </small>
                  {["REJECTED", "CANCELLED"].includes(loan.status) &&
                    loan.rejectionReason && (
                      <small className="rejection-reason">
                        Alasan: {loan.rejectionReason}
                      </small>
                    )}
                </div>
                <b>{rupiah(loan.principalAmount)}</b>
                <span className={`status ${loan.status.toLowerCase()}`}>
                  {loanStatus[loan.status] ?? loan.status}
                </span>
                {["PENDING", "APPROVED"].includes(loan.status) && (
                  <div className="loan-actions">
                    {loan.approvalRequest ? (
                      <button
                        onClick={() => openApproval(loan.approvalRequest!.id)}
                      >
                        Lihat persetujuan
                      </button>
                    ) : (
                      <small>
                        Pinjaman lama: perlu tinjauan migrasi oleh pengelola.
                      </small>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      )}
      {active === "Notifikasi" && (
        <NotificationInbox
          key={user.id}
          currentFamilyId={user.familyId}
          onOpenApproval={openApproval}
          onUnreadChanged={unreadNotifications.refresh}
          onNavigate={navigate}
          onOpenInstallment={openPayment}
        />
      )}
      {active === "Pengaturan" && <EmailSettings key={user.id} />}
      {active === "Panduan" && <HelpGuide user={user} onNavigate={navigate} />}
      {active === "Cicilan" && paymentInstallmentId && (
        <InstallmentPayment
          key={`${user.id}:${paymentInstallmentId}`}
          id={paymentInstallmentId}
          onClose={closePayment}
          onSettled={refreshFinancials}
        />
      )}
      {active === "Cicilan" && !paymentInstallmentId && (
        <section className="panel loan-list installment-list">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">JADWAL PEMBAYARAN</p>
              <h2>{canManageLoans ? "Cicilan keluarga" : "Cicilan saya"}</h2>
              <p className="panel-description">
                Pilih nama untuk melihat detail pinjaman dan jadwal cicilannya.
              </p>
            </div>
          </div>
          {loansLoading ? (
            <LoadingState label="Memuat jadwal cicilan..." />
          ) : loansError ? (
            <Feedback tone="error">
              <p>{loansError}</p>
              <button className="secondary-button" onClick={loadLoans}>
                Coba lagi
              </button>
            </Feedback>
          ) : installmentGroups.length === 0 ? (
            <p className="empty">Belum ada jadwal cicilan.</p>
          ) : (
            <div className="installment-groups">
              {installmentGroups.map((group) => {
                const expanded = expandedBorrowers.includes(group.borrowerId);
                const remaining = group.installments.reduce(
                  (total, item) =>
                    total +
                    BigInt(
                      String(item.installment.remainingAmount).replace(
                        /\.00?$/,
                        "",
                      ),
                    ),
                  0n,
                );
                const unpaid = group.installments.filter(
                  (item) => item.installment.status !== "PAID",
                ).length;
                return (
                  <article
                    className={
                      expanded
                        ? "installment-group expanded"
                        : "installment-group"
                    }
                    key={group.borrowerId}
                  >
                    <button
                      className="installment-group-header"
                      onClick={() =>
                        setExpandedBorrowers((current) =>
                          expanded
                            ? current.filter((id) => id !== group.borrowerId)
                            : [...current, group.borrowerId],
                        )
                      }
                      aria-expanded={expanded}
                    >
                      <span className="avatar coral">
                        {group.borrowerName.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="installment-group-person">
                        <strong>{group.borrowerName}</strong>
                        <small>
                          {group.loans.length} pinjaman · {unpaid} cicilan belum
                          lunas
                        </small>
                      </span>
                      <b>{rupiah(remaining)}</b>
                      <ChevronDown size={18} />
                    </button>
                    {expanded && (
                      <div className="installment-group-detail">
                        {group.loans.map((loan) => (
                          <div className="installment-loan" key={loan.id}>
                            <div className="installment-loan-heading">
                              <div>
                                <strong>{loan.purpose}</strong>
                                <small>
                                  {rupiah(loan.principalAmount)} ·{" "}
                                  {loan.tenorMonths} bulan ·{" "}
                                  {loanStatus[loan.status] ?? loan.status}
                                </small>
                              </div>
                              <span
                                className={`status ${loan.status.toLowerCase()}`}
                              >
                                {loanStatus[loan.status] ?? loan.status}
                              </span>
                            </div>
                            <div className="installment-detail-list">
                              {loan.installments.map((installment) => (
                                <div
                                  className="installment-detail-row"
                                  key={installment.id}
                                >
                                  <span>
                                    Cicilan {installment.installmentNumber}
                                  </span>
                                  <small>
                                    Jatuh tempo{" "}
                                    {date.format(new Date(installment.dueDate))}
                                  </small>
                                  <b>{rupiah(installment.remainingAmount)}</b>
                                  <span
                                    className={`status ${installment.status.toLowerCase()}`}
                                  >
                                    {installmentStatus[installment.status] ??
                                      installment.status}
                                  </span>
                                  <button
                                    className="secondary-button"
                                    onClick={() => openPayment(installment.id)}
                                  >
                                    Lihat pembayaran
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
      {active === "Anggota" && (
        <>
          {isSuperAdmin && (
            <section className="panel family-context">
              <SearchableSelect
                label="Keluarga yang ditampilkan"
                value={memberFamilyId}
                placeholder="Semua keluarga"
                disabled={familiesLoading}
                options={families.map((family) => ({
                  value: family.id,
                  label: `${family.name} · ${family.code}`,
                }))}
                onChange={(next) => {
                  setMemberFamilyId(next);
                  setMembers([]);
                  void loadMembers(next);
                }}
              />
              {familiesLoading && (
                <LoadingState label="Memuat daftar keluarga..." />
              )}
              {familiesError && (
                <Feedback tone="error">{familiesError}</Feedback>
              )}
            </section>
          )}
          <section className="member-stats">
            <article>
              <span className="stat-icon coral-light">
                <Users size={17} />
              </span>
              <div>
                <strong>{membersLoading ? "…" : members.length}</strong>
                <small>Total anggota</small>
              </div>
            </article>
            <article>
              <span className="stat-icon green-light">
                <ShieldCheck size={17} />
              </span>
              <div>
                <strong>
                  {membersLoading
                    ? "…"
                    : members.filter((member) => member.status === "ACTIVE")
                        .length}
                </strong>
                <small>Akses aktif</small>
              </div>
            </article>
            <article>
              <span className="stat-icon neutral-light">
                <HandCoins size={17} />
              </span>
              <div>
                <strong>
                  {membersLoading
                    ? "…"
                    : members.filter((member) => member.role === "TREASURER")
                        .length}
                </strong>
                <small>Pengelola dana</small>
              </div>
            </article>
          </section>
          <section className="panel member-list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">RUANG KELUARGA</p>
                <h2>Daftar anggota</h2>
                <p className="panel-description">
                  Periksa identitas dan akses setiap orang di ruang ini.
                </p>
              </div>
            </div>
            {membersLoading ? (
              <LoadingState label="Memuat data anggota..." />
            ) : membersError ? (
              <Feedback tone="error">
                <p>{membersError}</p>
                <button
                  className="secondary-button"
                  onClick={() => void loadMembers()}
                >
                  Coba lagi
                </button>
              </Feedback>
            ) : members.length === 0 ? (
              <p className="empty">
                {isSuperAdmin && !memberFamilyId
                  ? "Belum ada anggota terdaftar di seluruh keluarga."
                  : "Belum ada anggota di ruang keluarga ini. Admin dapat menambahkan anggota melalui tombol Tambah anggota."}
              </p>
            ) : (
              <div className="member-table">
                <div className="member-table-head">
                  <span>ANGGOTA</span>
                  <span>PERAN</span>
                  <span>STATUS</span>
                  <span>TERDAFTAR</span>
                </div>
                {members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <div className="member-identity">
                      <span className="avatar coral">
                        {member.user.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{member.user.name}</strong>
                        <small>{member.user.email || member.user.phone}</small>
                        {isSuperAdmin && member.family && (
                          <small>
                            {member.family.name} · {member.family.code}
                          </small>
                        )}
                      </div>
                    </div>
                    <span className="role-label">
                      {member.role === "ADMIN"
                        ? "Admin keluarga"
                        : member.role === "TREASURER"
                          ? "Pengelola dana"
                          : "Anggota"}
                    </span>
                    <span className={`status ${member.status.toLowerCase()}`}>
                      {member.status === "ACTIVE" ? "Aktif" : "Tidak aktif"}
                    </span>
                    <small className="joined-date">
                      {date.format(new Date(member.joinedAt))}
                      {canManageMembers &&
                        member.user.systemRole !== "SUPER_ADMIN" && (
                          <button
                            type="button"
                            className="secondary-button member-edit-button"
                            aria-label={`Edit peran ${member.user.name}`}
                            onClick={() => setEditingMember(member)}
                          >
                            <Pencil size={16} aria-hidden="true" /> Edit peran
                          </button>
                        )}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {active === "Ringkasan" && (
        <section className="welcome">
          <div>
            <p className="kicker">RUANG DANA</p>
            <h2>Ringkasan kas keluarga.</h2>
            <p>
              Saldo dan aktivitas di bawah ini berasal dari catatan kas keluarga
              yang tersimpan di database.
            </p>
            <button className="text-button" onClick={() => navigate("Kas")}>
              Buka catatan kas <ArrowUpRight size={15} />
            </button>
          </div>
        </section>
      )}
      {active === "Kas" && (
        <FamilyCash
          key={user?.familyId}
          revision={cashRevision}
          onRequestLoan={
            canRequestLoan
              ? () => {
                  navigate("Pinjaman");
                  setLoanFormOpen(true);
                }
              : undefined
          }
          onChanged={refreshFinancials}
        />
      )}
      {active === "Kas" && (
        <section className="panel ledger-list">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CATATAN KAS</p>
              <h2>Arus kas keluarga</h2>
              <p className="panel-description">
                Catat pemasukan dan pengeluaran agar saldo keluarga tetap
                akurat. Menampilkan hingga 100 catatan terbaru.
              </p>
            </div>
            {canManageLedger && (
              <button
                className="primary"
                onClick={() => setLedgerFormOpen(true)}
              >
                <WalletCards size={15} />
                Catat kas
              </button>
            )}
          </div>
          {ledgerLoading ? (
            <LoadingState label="Memuat catatan kas..." />
          ) : ledgerError ? (
            <Feedback tone="error">
              {ledgerError}
              <button className="secondary-button" onClick={loadLedger}>
                Coba lagi
              </button>
            </Feedback>
          ) : ledger.length === 0 ? (
            <p className="empty">Belum ada catatan kas.</p>
          ) : (
            <div className="ledger-rows">
              {ledger.map((entry) => (
                <div className="ledger-row" key={entry.id}>
                  <span
                    className={
                      entry.direction === "IN"
                        ? "ledger-icon incoming"
                        : "ledger-icon outgoing"
                    }
                  >
                    {entry.direction === "IN" ? (
                      <ArrowDownRight size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{entry.description}</strong>
                    <small>
                      {ledgerLabels[entry.type] ?? entry.type} · Tercatat
                    </small>
                    {entry.balanceBefore != null &&
                      entry.balanceAfter != null && (
                        <small>
                          Saldo {rupiah(entry.balanceBefore)} →{" "}
                          {rupiah(entry.balanceAfter)}
                        </small>
                      )}
                    {entry.referenceId && (
                      <small className="ledger-reference">
                        Referensi: {entry.referenceId}
                      </small>
                    )}
                    <small>
                      {date.format(new Date(entry.occurredAt))} ·{" "}
                      {entry.createdBy?.name ?? "Pengelola"}
                    </small>
                  </div>
                  <b
                    className={
                      entry.direction === "IN" ? "positive" : "negative"
                    }
                  >
                    {entry.direction === "IN" ? "+" : "−"}{" "}
                    {rupiah(entry.amount)}
                  </b>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {active === "Ringkasan" && (
        <>
          {!summary && !summaryError && (
            <LoadingState label="Memuat ringkasan keluarga..." />
          )}
          {summaryError && (
            <Feedback tone="error">
              {summaryError}
              <button className="secondary-button" onClick={refreshFinancials}>
                Coba lagi
              </button>
            </Feedback>
          )}
          <div className="section-heading">
            <div>
              <p className="eyebrow">POSISI DANA</p>
              <h2>Gambaran ruang bersama</h2>
            </div>
          </div>
          <section className="metrics">
            <article className="metric primary-metric">
              <p>SALDO BERSAMA</p>
              <small>Saldo tersedia</small>
              <strong>
                {summary ? rupiah(summary.balance) : "Belum tersedia"}
              </strong>
              <span className="positive">
                <ArrowUpRight size={14} /> ruang dana aktif
              </span>
            </article>
            <article className="metric">
              <p>Sedang dipinjamkan</p>
              <strong>
                {summary ? rupiah(summary.loans) : "Belum tersedia"}
              </strong>
              <small>berdasarkan data aktif</small>
            </article>
            <article className="metric">
              <p>Sisa cicilan belum lunas</p>
              <strong>
                {summary ? rupiah(summary.installments) : "Belum tersedia"}
              </strong>
              <small>dari jadwal pembayaran</small>
            </article>
          </section>
          <section className="panel ledger-list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">AKTIVITAS TERBARU</p>
                <h2>Arus kas terbaru</h2>
              </div>
              <button className="text-button" onClick={() => navigate("Kas")}>
                Lihat semua <ArrowUpRight size={15} />
              </button>
            </div>
            {ledgerError ? (
              <Feedback tone="error">{ledgerError}</Feedback>
            ) : ledger.length === 0 ? (
              <p className="empty">Belum ada aktivitas kas.</p>
            ) : (
              <div className="ledger-rows">
                {ledger.slice(0, 5).map((entry) => (
                  <div className="ledger-row" key={entry.id}>
                    <span
                      className={
                        entry.direction === "IN"
                          ? "ledger-icon incoming"
                          : "ledger-icon outgoing"
                      }
                    >
                      {entry.direction === "IN" ? (
                        <ArrowDownRight size={16} />
                      ) : (
                        <ArrowUpRight size={16} />
                      )}
                    </span>
                    <div>
                      <strong>{entry.description}</strong>
                      <small>{date.format(new Date(entry.occurredAt))}</small>
                    </div>
                    <b
                      className={
                        entry.direction === "IN" ? "positive" : "negative"
                      }
                    >
                      {entry.direction === "IN" ? "+" : "−"}{" "}
                      {rupiah(entry.amount)}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {ledgerFormOpen && (
        <Modal
          title="Catat arus kas"
          onClose={() => setLedgerFormOpen(false)}
          busy={loading}
        >
          <ValidatedForm onSubmit={submitLedger}>
            {notice?.tone === "error" && (
              <Feedback tone="error">{notice.message}</Feedback>
            )}
            <fieldset disabled={loading} className="form-fields">
              <label>
                Jenis catatan
                <select
                  value={ledgerForm.direction}
                  onChange={(event) =>
                    setLedgerForm({
                      ...ledgerForm,
                      direction: event.target.value,
                    })
                  }
                >
                  <option value="IN">Pemasukan</option>
                  <option value="OUT">Pengeluaran</option>
                </select>
              </label>
              <CurrencyInput
                label="Nominal"
                required
                value={ledgerForm.amount}
                onChange={(amount) => setLedgerForm({ ...ledgerForm, amount })}
              />
              <label>
                Keterangan
                <textarea
                  required
                  minLength={3}
                  value={ledgerForm.description}
                  onChange={(event) =>
                    setLedgerForm({
                      ...ledgerForm,
                      description: event.target.value,
                    })
                  }
                  placeholder="Contoh: Setoran bulanan keluarga"
                />
              </label>
            </fieldset>
            <div className="dialog-actions">
              <button type="submit" className="primary" disabled={loading}>
                {loading ? "Menyimpan..." : "Simpan catatan"}
              </button>
            </div>
          </ValidatedForm>
        </Modal>
      )}
      {editingMember && (
        <EditMemberRole
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={(role) => {
            if (editingMember.user.id === user.id) {
              setUser({
                ...user,
                familyRole: role,
                families: user.families?.map((family) =>
                  family.id === editingMember.family?.id
                    ? { ...family, role }
                    : family,
                ),
              });
            }
            setEditingMember(null);
            showNotice("Peran anggota berhasil diperbarui.");
            void loadMembers();
          }}
        />
      )}
      {loanFormOpen && canRequestLoan && (
        <FundTransactionDialog
          intent="loan-requests"
          onClose={() => setLoanFormOpen(false)}
          onSaved={(message) => {
            setLoanFormOpen(false);
            showNotice(message);
            refreshFinancials();
            void loadLoans();
          }}
        />
      )}
      {memberFormOpen && (
        <RegistrationDialog
          user={user}
          onClose={() => setMemberFormOpen(false)}
          onCreated={(data, message) => {
            setMemberFormOpen(false);
            showNotice(message);
            if (user.systemRole === "SUPER_ADMIN") {
              setFamilies((current) =>
                current.some((item) => item.id === data.family.id)
                  ? current
                  : [...current, data.family],
              );
              setMemberFamilyId(data.family.id);
            }
            void loadMembers(data.family.id);
          }}
        />
      )}
      <footer>
        © 2026 Dana Keluarga <span>◈ Data ruang ini hanya untuk keluarga</span>
      </footer>
    </AppShell>
  );
}
export default App;
