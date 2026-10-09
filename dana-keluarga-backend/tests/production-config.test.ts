import { describe, it, expect } from "vitest";
import { validateProductionConfig } from "../src/config/production-config";
const config = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "a1".repeat(32),
  JWT_REFRESH_SECRET: "b2".repeat(32),
  FRONTEND_URL: "https://dana.bulmar.tech",
};
describe("production startup protection", () => {
  it("accepts HTTPS domains and distinct keys", () =>
    expect(() => validateProductionConfig(config)).not.toThrow());
  it.each(["replace-with-a-long-secret", "change-me-now".repeat(5), "short"])(
    "rejects sample or short JWT keys: %s",
    (key) =>
      expect(() =>
        validateProductionConfig({ ...config, JWT_ACCESS_SECRET: key }),
      ).toThrow(/JWT_ACCESS_SECRET/),
  );
  it("rejects identical keys", () =>
    expect(() =>
      validateProductionConfig({
        ...config,
        JWT_REFRESH_SECRET: config.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/berbeda/));
  it.each([
    "http://localhost:5173",
    "https://localhost",
    "https://127.0.0.1",
    "http://dana.bulmar.tech",
    "https://example.com",
    "https://app.local",
    "https://user:pass@dana.bulmar.tech",
  ])("rejects unsafe production app URL: %s", (FRONTEND_URL) =>
    expect(() => validateProductionConfig({ ...config, FRONTEND_URL })).toThrow(
      /HTTPS/,
    ),
  );
  it("validates the email URL even with a valid frontend origin", () =>
    expect(() =>
      validateProductionConfig({
        ...config,
        PUBLIC_APP_URL: "http://localhost:5173",
      }),
    ).toThrow(/PUBLIC_APP_URL/));
  it("allows localhost for local development", () =>
    expect(() =>
      validateProductionConfig({
        ...config,
        NODE_ENV: "development",
        FRONTEND_URL: "http://localhost:5173",
      }),
    ).not.toThrow());
});
