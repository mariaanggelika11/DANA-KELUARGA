import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../src/modules/auth/auth.schemas";

const input = {
  token: "a".repeat(64),
  newPassword: "valid-new-password",
  confirmPassword: "valid-new-password",
};
describe("password recovery input", () => {
  it("normalizes email and refuses account impersonation fields", () => {
    expect(forgotPasswordSchema.parse({ email: " USER@EXAMPLE.COM " })).toEqual(
      { email: "user@example.com" },
    );
    expect(
      forgotPasswordSchema.safeParse({
        email: "user@example.com",
        userId: "another-user",
      }).success,
    ).toBe(false);
  });
  it.each([
    { ...input, token: "short" },
    { ...input, token: "z".repeat(64) },
    { ...input, token: "a".repeat(65) },
    { ...input, newPassword: "short", confirmPassword: "short" },
    { ...input, newPassword: " ".repeat(8), confirmPassword: " ".repeat(8) },
    {
      ...input,
      newPassword: "a".repeat(129),
      confirmPassword: "a".repeat(129),
    },
    { ...input, confirmPassword: "different" },
    { ...input, userId: "another-user" },
  ])(
    "rejects malformed tokens, weak inputs, mismatch or injected account IDs",
    (invalid) => {
      expect(resetPasswordSchema.safeParse(invalid).success).toBe(false);
    },
  );
  it("preserves intentional spaces in a matching password", () => {
    const password = " valid-new-password ";
    expect(
      resetPasswordSchema.parse({
        ...input,
        newPassword: password,
        confirmPassword: password,
      }).newPassword,
    ).toBe(password);
  });
});
