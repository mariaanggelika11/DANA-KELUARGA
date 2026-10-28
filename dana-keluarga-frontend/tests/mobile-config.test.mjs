import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMobileApi } from "../scripts/mobile-config.ts";

test("mobile build requires a remote HTTPS API and strips trailing slashes", () => {
  assert.equal(
    validateMobileApi("https://api.keluarga.id/api/v1/"),
    "https://api.keluarga.id/api/v1",
  );
  for (const value of [
    undefined,
    "",
    "/api/v1",
    "http://api.keluarga.id/api/v1",
    "https://localhost/api/v1",
    "https://127.0.0.1/api/v1",
    "https://user:pass@api.keluarga.id",
    "https://api.keluarga.id?token=secret",
  ]) {
    assert.throws(() => validateMobileApi(value));
  }
});
