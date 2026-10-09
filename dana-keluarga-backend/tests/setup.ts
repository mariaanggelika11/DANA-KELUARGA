// Tests must never use the database or credentials from the local .env.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dana_test",
  JWT_ACCESS_SECRET: "test-access-secret-not-for-production",
  JWT_REFRESH_SECRET: "test-refresh-secret-not-for-production",
  FRONTEND_URL: "http://localhost:5173",
  REMINDER_HOUR_WIB: "9",
  EMAIL_MODE: "simulation",
  EMAIL_FROM: "Dana Keluarga <no-reply@example.invalid>",
  EMAIL_REPLY_TO: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  RESEND_API_KEY: "",
});
