import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BREACH_CHECK_TIMEOUT_MS,
  checkPasswordBreach,
} from "@/server/auth/password-breach";

afterEach(() => vi.useRealTimers());

describe("checkPasswordBreach", () => {
  it("is breached when the lookup says the password is in the corpus", async () => {
    expect(await checkPasswordBreach("pw", async () => true)).toBe("breached");
  });

  it("is ok when the lookup says it is not", async () => {
    expect(await checkPasswordBreach("pw", async () => false)).toBe("ok");
  });

  it("is unavailable (fail closed) when the lookup throws", async () => {
    expect(
      await checkPasswordBreach("pw", async () => {
        throw new Error("Failed to check password. Status: 503");
      }),
    ).toBe("unavailable");
  });

  it("gives up waiting after the timeout instead of hanging the form", async () => {
    vi.useFakeTimers();
    const pending = checkPasswordBreach("pw", () => new Promise<boolean>(() => {}));
    await vi.advanceTimersByTimeAsync(BREACH_CHECK_TIMEOUT_MS + 1);
    expect(await pending).toBe("unavailable");
  });

  it("passes the password to the lookup unchanged", async () => {
    const lookup = vi.fn(async () => false);
    await checkPasswordBreach("Sp3cial pass!", lookup);
    expect(lookup).toHaveBeenCalledWith("Sp3cial pass!");
  });
});
