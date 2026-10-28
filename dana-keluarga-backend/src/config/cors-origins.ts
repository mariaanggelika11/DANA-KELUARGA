const nativeOrigins = new Set(["https://localhost", "capacitor://localhost"]);

export function allowedOrigins(frontend: string, mobileOrigins: string) {
  const mobile = mobileOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of mobile) {
    if (!nativeOrigins.has(origin))
      throw new Error(`Origin mobile tidak didukung: ${origin}`);
  }
  return [frontend, ...new Set(mobile)];
}
