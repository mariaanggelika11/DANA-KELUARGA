import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  loanInstallment: { updateMany: vi.fn(), findMany: vi.fn() },
  emailMessage: { updateMany: vi.fn(), findMany: vi.fn() },
}));
vi.mock("../src/config/prisma", () => ({ prisma: db }));
import { env } from "../src/config/env";
import {
  notificationFailure,
  startNotificationWorker,
} from "../src/modules/notifications/notification.worker";
let stop: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T10:00:00+07:00"));
  vi.resetAllMocks();
  env.EMAIL_MODE = "simulation";
  env.NOTIFICATION_POLL_MS = 1000;
  db.loanInstallment.findMany.mockResolvedValue([]);
  db.emailMessage.findMany.mockResolvedValue([]);
});
afterEach(async () => {
  await stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("notification worker recovery", () => {
  it("distinguishes connectivity from missing schema without exposing raw errors", () => {
    expect(
      notificationFailure({
        errorCode: "P1001",
        message: "secret connection URL",
      }),
    ).toMatchObject({
      code: "P1001",
      guidance: expect.stringContaining("Koneksi"),
    });
    expect(notificationFailure({ code: "P2022" }).guidance).toContain(
      "migrate deploy",
    );
    expect(
      JSON.stringify(notificationFailure(new Error("secret"))),
    ).not.toContain("secret");
  });
  it("backs off on connection failure then resumes processing and reports recovery", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    db.loanInstallment.updateMany
      .mockRejectedValueOnce({ code: "P1001", message: "secret" })
      .mockResolvedValue({ count: 0 });
    stop = startNotificationWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[P1001]"));
    await vi.advanceTimersByTimeAsync(9000);
    expect(db.loanInstallment.updateMany).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.loanInstallment.updateMany).toHaveBeenCalledTimes(2);
    expect(db.emailMessage.findMany).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("pulih"));
    await stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(db.loanInstallment.updateMany).toHaveBeenCalledTimes(2);
  });
});
