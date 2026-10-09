import { useFinancialData } from "./hooks/useFinancialData";
import { PageIntro } from "./components/layout/PageIntro";
import { LoginForm } from "./features/auth/LoginForm";
import { PasswordRecovery } from "./features/auth/PasswordRecovery";
import { usePasswordRecovery } from "./features/auth/usePasswordRecovery";
import { ChangePassword } from "./features/account/ChangePassword";
import { LoanList } from "./features/loans/LoanList";
import { InstallmentSchedule } from "./features/payments/InstallmentSchedule";
import { MemberList } from "./features/members/MemberList";
import { LedgerList } from "./features/cash/LedgerList";
import { FamilySummary } from "./features/dashboard/FamilySummary";
import type { Member, Family } from "./types/members";
import { BankAccountSettings } from "./components/BankAccountSettings";
import { PendingTransfers } from "./components/PendingTransfers";
import { version as appVersion } from "../package.json";
import { FundTransactionDialog } from "./features/cash/FundTransactionDialog";
import { LoadingState } from "./components/LoadingState";
import { EditMemberRole } from "./features/members/EditMemberRole";
import { FamilyCash } from "./features/cash/FamilyCash";
import { CurrencyInput } from "./components/CurrencyInput";
import { currencyError } from "./lib/currency";
import { useEffect, useRef, useState, type FormEvent } from "react";
import "./App.css";
import { HierarchySetup } from "./features/approvals/HierarchySetup";
import { ApprovalInbox } from "./features/approvals/ApprovalInbox";
import { Feedback } from "./components/Feedback";
import { ValidatedForm } from "./components/ValidatedForm";
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
import { rupiah } from "./lib/format";
import { api, ApiError } from "./lib/api-client";

type User = SessionUser;
type Notice = { message: string; tone: "success" | "warning" | "error" };

function App() {
  const recovery = usePasswordRecovery();
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
  const [cashBackgroundRevision, setCashBackgroundRevision] = useState(0);
  const {
    summary,
    summaryError,
    loans,
    loansLoading,
    loansError,
    ledger,
    ledgerLoading,
    ledgerError,
    ledgerPage,
    ledgerTotal,
    loadSummary,
    loadLoans,
    loadLedger,
    changeLedgerPage,
    resetFinancials,
  } = useFinancialData(user, active, setCashBackgroundRevision);
  const refreshFinancials = () => {
    setCashRevision((value) => value + 1);
    unreadNotifications.refresh();
    void loadLoans();
    void loadLedger();
    void loadSummary();
  };
  const ledgerKey = useRef(crypto.randomUUID());
  const [ledgerFormOpen, setLedgerFormOpen] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({
    direction: "IN",
    amount: "",
    description: "",
  });
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
              "Ubah password",
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
    const expired = (event: Event) => {
      const passwordChanged =
        event instanceof CustomEvent &&
        ["PASSWORD_CHANGED", "PASSWORD_RESET"].includes(event.detail?.reason);
      ++memberLoadSequence.current;
      setUser(null);
      setMembers([]);
      resetFinancials();
      setLedgerFormOpen(false);
      setMemberFormOpen(false);
      setLoanFormOpen(false);
      setFamilies([]);
      setNotice(null);
      setLoginForm((current) => ({ ...current, password: "" }));
      setLoginErrorCode(passwordChanged ? "PASSWORD_CHANGED" : "");
      setLoginError(
        passwordChanged
          ? "Password berhasil diubah. Silakan masuk kembali dengan password baru."
          : "Sesi Anda telah berakhir. Silakan masuk kembali.",
      );
    };
    window.addEventListener("dana:session-expired", expired);
    return () => window.removeEventListener("dana:session-expired", expired);
  }, [resetFinancials]);
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
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    if (user.systemRole !== "SUPER_ADMIN") {
      void loadSummary(controller.signal);
      void loadLoans(false, controller.signal);
    }
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
  }, [user, loadSummary, loadLoans]);
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
    resetFinancials();
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
  const canManageLoans = !isSuperAdmin && (isFamilyAdmin || isTreasurer);
  const canRequestLoan =
    user?.systemRole === "USER" && loanPermissions.data?.canCreateLoan === true;
  const canManageLedger = !isSuperAdmin && (isFamilyAdmin || isTreasurer);
  const [expandedBorrowers, setExpandedBorrowers] = useState<string[]>([]);
  const openMemberForm = () => setMemberFormOpen(true);
  if (recovery.recovery)
    return (
      <PasswordRecovery
        key={recovery.recovery.mode}
        {...recovery.recovery}
        onClose={() => {
          recovery.close();
          setActive(
            user?.systemRole === "SUPER_ADMIN" ? "Setup Hirarki" : "Ringkasan",
          );
        }}
        onRequestNew={recovery.open}
      />
    );
  if (sessionLoading)
    return (
      <main className="login-page">
        <LoadingState label="Memeriksa sesi Anda..." />
      </main>
    );
  if (!user)
    return (
      <LoginForm
        email={loginForm.email}
        password={loginForm.password}
        busy={loginLoading}
        error={loginError}
        errorCode={loginErrorCode}
        onSubmit={login}
        onForgotPassword={recovery.open}
        onEmailChange={(email) => {
          setLoginError("");
          setLoginForm((current) => ({ ...current, email }));
        }}
        onPasswordChange={(password) => {
          setLoginError("");
          setLoginForm((current) => ({ ...current, password }));
        }}
      />
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
      {active !== "Ubah password" && <FamilySwitcher user={user} />}
      <PageIntro
        active={active}
        user={user}
        canManageLoans={canManageLoans}
        onNavigate={navigate}
        onAddMember={
          active === "Anggota" && canManageMembers ? openMemberForm : undefined
        }
      />
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
        <LoanList
          loans={loans}
          loading={loansLoading}
          error={loansError}
          canManageLoans={canManageLoans}
          canRequestLoan={canRequestLoan}
          permissions={loanPermissions}
          onRequest={() => setLoanFormOpen(true)}
          onRetry={() => void loadLoans()}
          onOpenApproval={openApproval}
        />
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
      {active === "Pengaturan" && (
        <>
          {!isSuperAdmin && user.familyId ? (
            <BankAccountSettings key={`bank:${user.id}:${user.familyId}`} />
          ) : (
            <Feedback tone="info">
              {isSuperAdmin
                ? "Rekening pembayaran diatur oleh pengelola dana masing-masing keluarga."
                : "Pengaturan rekening tersedia setelah Anda bergabung dengan keluarga aktif."}
            </Feedback>
          )}
        </>
      )}
      {active === "Ubah password" && (
        <ChangePassword key={`password:${user.id}`} />
      )}
      {active === "Panduan" && <HelpGuide user={user} onNavigate={navigate} />}
      {active === "Cicilan" && paymentInstallmentId && (
        <InstallmentPayment
          key={`${user.id}:${paymentInstallmentId}`}
          id={paymentInstallmentId}
          onClose={closePayment}
          onSettled={refreshFinancials}
        />
      )}
      {active === "Cicilan" &&
        !paymentInstallmentId &&
        isTreasurer &&
        !isSuperAdmin && (
          <PendingTransfers
            key={`${user.id}:${user.familyId}`}
            onOpen={openPayment}
            revision={cashRevision}
            backgroundRevision={cashBackgroundRevision}
          />
        )}
      {active === "Cicilan" && !paymentInstallmentId && (
        <InstallmentSchedule
          loans={loans}
          loading={loansLoading}
          error={loansError}
          canManageLoans={canManageLoans}
          expandedBorrowers={expandedBorrowers}
          onToggleBorrower={(id) =>
            setExpandedBorrowers((current) =>
              current.includes(id)
                ? current.filter((value) => value !== id)
                : [...current, id],
            )
          }
          onOpenPayment={openPayment}
          onRetry={() => void loadLoans()}
        />
      )}
      {active === "Anggota" && (
        <MemberList
          members={members}
          loading={membersLoading}
          error={membersError}
          isSuperAdmin={Boolean(isSuperAdmin)}
          canManageMembers={canManageMembers}
          families={families}
          familiesLoading={familiesLoading}
          familiesError={familiesError}
          memberFamilyId={memberFamilyId}
          onFamilyChange={(next) => {
            setMemberFamilyId(next);
            setMembers([]);
            void loadMembers(next);
          }}
          onRetry={() => void loadMembers()}
          onEdit={setEditingMember}
        />
      )}
      {active === "Kas" && (
        <FamilyCash
          key={user?.familyId}
          revision={cashRevision}
          backgroundRevision={cashBackgroundRevision}
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
        <LedgerList
          entries={ledger}
          loans={loans}
          loading={ledgerLoading}
          error={ledgerError}
          canManageLedger={canManageLedger}
          page={ledgerPage}
          total={ledgerTotal}
          onCreate={() => setLedgerFormOpen(true)}
          onRetry={() => void loadLedger()}
          onPageChange={changeLedgerPage}
        />
      )}
      {active === "Ringkasan" && (
        <FamilySummary
          summary={summary}
          summaryError={summaryError}
          ledger={ledger}
          ledgerError={ledgerError}
          onOpenCash={() => void navigate("Kas")}
          onRetry={refreshFinancials}
        />
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
        © 2026 Dana Keluarga · v{appVersion}{" "}
        <span>◈ Data ruang ini hanya untuk keluarga</span>
      </footer>
    </AppShell>
  );
}
export default App;
