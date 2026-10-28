export function validateMobileApi(value: string | undefined) {
  if (!value)
    throw new Error(
      "Build mobile memerlukan VITE_API_BASE_URL HTTPS di .env.mobile.local.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    throw new Error(
      "API mobile wajib berupa URL HTTPS tanpa kredensial/query, bukan localhost.",
    );
  }
  return value.replace(/\/+$/, "");
}
