const apiBase =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:3000/api/v1" : "/api/v1");
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
let refreshing: Promise<boolean> | null = null;
function currentFamily(accessToken: string | null): string | undefined {
  try {
    return JSON.parse(
      atob(accessToken!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ).familyId;
  } catch {
    return undefined;
  }
}
async function refreshSession() {
  if (refreshing) return refreshing;
  const token = localStorage.getItem("dana_refresh_token");
  if (!token) return false;
  refreshing = (async () => {
    const response = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        refreshToken: token,
        familyId: currentFamily(localStorage.getItem("dana_access_token")),
      }),
    });
    if (response.status === 401) return false;
    if (!response.ok)
      throw new ApiError(
        "Sesi belum dapat diperbarui. Silakan coba lagi.",
        response.status,
      );
    const payload = await response.json();
    if (!payload?.data?.accessToken || !payload?.data?.refreshToken)
      throw new ApiError("Respons sesi tidak dapat dibaca.", 502);
    // A logout or another login while refreshing must not resurrect the old session.
    if (localStorage.getItem("dana_refresh_token") !== token) return false;
    localStorage.setItem("dana_access_token", payload.data.accessToken);
    localStorage.setItem("dana_refresh_token", payload.data.refreshToken);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
export function expireSession(reason?: "PASSWORD_CHANGED" | "PASSWORD_RESET") {
  localStorage.removeItem("dana_access_token");
  localStorage.removeItem("dana_refresh_token");
  window.dispatchEvent(
    new CustomEvent("dana:session-expired", { detail: { reason } }),
  );
}
export async function api<T>(
  path: string,
  options?: RequestInit,
  retried = false,
): Promise<T> {
  const accessToken = localStorage.getItem("dana_access_token");
  const timeout = AbortSignal.timeout(20000);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(options?.headers ?? {}),
      },
    });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new ApiError(
      timeout.aborted
        ? "Server belum merespons. Periksa status data sebelum mengirim ulang."
        : "Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.",
      0,
      timeout.aborted ? "TIMEOUT" : "NETWORK_ERROR",
    );
  }
  const payload = await response.json().catch(() => null);
  if (
    response.status === 401 &&
    !path.startsWith("/auth/login") &&
    path !== "/auth/logout"
  ) {
    if (!retried && accessToken) {
      try {
        if (await refreshSession()) return api<T>(path, options, true);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          "Koneksi terputus saat memperbarui sesi. Silakan coba lagi.",
          0,
          "NETWORK_ERROR",
        );
      }
    }
    if (localStorage.getItem("dana_access_token") === accessToken)
      expireSession();
  }
  if (!response.ok) {
    const fallback: Record<number, string> = {
      400: "Periksa kembali isian Anda.",
      401:
        path === "/auth/login"
          ? "Email atau password yang Anda masukkan tidak sesuai."
          : "Sesi Anda telah berakhir. Silakan masuk kembali.",
      403: "Anda tidak memiliki akses untuk melakukan tindakan ini.",
      404: "Data tidak ditemukan atau tidak dapat diakses.",
      409: "Data sudah digunakan atau telah berubah. Periksa kembali sebelum menyimpan.",
      429: "Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi.",
      500: "Data belum berhasil diproses. Silakan coba lagi.",
      503: "Layanan belum tersedia. Silakan coba lagi nanti.",
    };
    const details = Array.isArray(payload?.error?.fields)
      ? payload.error.fields
          .map((field: { message?: unknown }) => field.message)
          .filter(
            (message: unknown): message is string =>
              typeof message === "string",
          )
      : [];
    const serverMessage =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : undefined;
    const loginMessages: Record<string, string> = {
      AUTH_EMAIL_NOT_REGISTERED:
        "Email ini belum terdaftar. Periksa kembali email Anda atau hubungi Admin untuk pendaftaran akun.",
      AUTH_PASSWORD_INCORRECT:
        "Password yang Anda masukkan salah. Silakan periksa dan coba lagi.",
      AUTH_ACCOUNT_INACTIVE:
        "Akun Anda tidak aktif. Hubungi Admin untuk bantuan.",
    };
    const loginMessage =
      path === "/auth/login" && response.status === 401
        ? loginMessages[payload?.error?.code]
        : undefined;
    const safeMessage =
      loginMessage ??
      (response.status === 401 ||
      response.status === 429 ||
      response.status >= 500
        ? (fallback[response.status] ??
          "Layanan belum dapat memproses permintaan.")
        : details.length
          ? [...new Set(details)].join(" ")
          : (serverMessage ??
            fallback[response.status] ??
            "Permintaan belum berhasil. Silakan coba lagi."));
    throw new ApiError(safeMessage, response.status, payload?.error?.code);
  }
  if (payload === null)
    throw new ApiError(
      "Respons server tidak dapat dibaca. Silakan coba lagi.",
      response.status,
      "INVALID_RESPONSE",
    );
  return payload as T;
}
