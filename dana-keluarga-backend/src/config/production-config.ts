// These checks run before the HTTP server or email worker starts.
export function validateProductionConfig(config: {
  NODE_ENV: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  FRONTEND_URL: string;
  PUBLIC_APP_URL?: string;
}) {
  if (config.NODE_ENV !== "production") return;
  const placeholder =
    /replace|change[-_ ]?me|example|test[-_ ]|placeholder|secret[-_ ]?not[-_ ]?for/i;
  for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
    const secret = config[name];
    if (secret.length < 32 || placeholder.test(secret))
      throw new Error(
        `${name} produksi harus berupa rahasia acak minimal 32 karakter, bukan nilai contoh.`,
      );
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET)
    throw new Error("Kunci JWT access dan refresh produksi harus berbeda.");
  for (const [name, value] of [
    ["FRONTEND_URL", config.FRONTEND_URL],
    ["PUBLIC_APP_URL", config.PUBLIC_APP_URL ?? config.FRONTEND_URL],
  ]) {
    const url = new URL(value!);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".test") ||
      host.endsWith(".invalid") ||
      host.endsWith(".example") ||
      host === "example.com" ||
      host.endsWith(".example.com") ||
      !host.includes(".") ||
      /^\d+(\.\d+){3}$/.test(host) ||
      host.includes(":")
    )
      throw new Error(
        `${name} produksi wajib memakai domain publik HTTPS aplikasi.`,
      );
  }
}
