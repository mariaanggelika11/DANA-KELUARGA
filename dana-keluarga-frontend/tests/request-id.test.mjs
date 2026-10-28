import { test } from "node:test";
import assert from "node:assert/strict";
import { requestId } from "../src/lib/request-id.ts";

test("LAN Safari fallback produces UUID v4 idempotency keys without randomUUID", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: original.getRandomValues.bind(original) },
  });
  try {
    const values = new Set(Array.from({ length: 100 }, () => requestId()));
    assert.equal(values.size, 100);
    for (const value of values)
      assert.match(
        value,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
});
