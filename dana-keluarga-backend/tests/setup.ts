// Tests must never use the database or credentials from the local .env.
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/dana_test',
  JWT_ACCESS_SECRET: 'test-access-secret-not-for-production', JWT_REFRESH_SECRET: 'test-refresh-secret-not-for-production',
  WHATSAPP_ENABLED: 'false', WHATSAPP_MODE: 'simulation', PAYMENT_PROVIDER: 'sandbox',
  FRONTEND_URL: 'http://localhost:5173', REMINDER_HOUR_WIB: '9',
});
