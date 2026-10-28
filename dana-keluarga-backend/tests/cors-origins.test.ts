import { describe, it, expect } from "vitest";
import { allowedOrigins } from "../src/config/cors-origins";

describe("mobile CORS origins", () => {
  it("keeps mobile access opt-in", () => {
    expect(allowedOrigins("https://keluarga.id", "")).toEqual([
      "https://keluarga.id",
    ]);
  });
  it("allows only configured native origins alongside the web app", () => {
    expect(
      allowedOrigins(
        "https://keluarga.id",
        " https://localhost,capacitor://localhost,https://localhost ",
      ),
    ).toEqual([
      "https://keluarga.id",
      "https://localhost",
      "capacitor://localhost",
    ]);
    expect(() => allowedOrigins("https://keluarga.id", "*")).toThrow();
    expect(() =>
      allowedOrigins("https://keluarga.id", "https://attacker.id"),
    ).toThrow();
  });
});
