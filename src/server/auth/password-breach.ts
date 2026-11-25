import "server-only";

import { isPasswordCompromised } from "better-auth/plugins";

/**
 * Breach check for a password a person chose (Have I Been Pwned "range" API: only the first five
 * characters of the password's SHA-1 leave the server, k-anonymity). Better Auth's `haveIBeenPwned`
 * plugin runs the same check on `changePassword` and friends inside `auth.ts`; this wrapper lets a
 * caller test BEFORE it has changed any state (enrolment turns two-factor on first, so a refusal
 * afterwards would leave a half-finished setup) and tell "breached" from "could not check".
 *
 * Policy when the service cannot be reached: FAIL CLOSED, the same as the plugin (it throws a 500
 * "Failed to check password"). A new password is only ever set at first enrolment or a password
 * reset, both of which wait for the person anyway: nothing is consumed by a refusal, the temporary
 * password keeps working for its 7 days, and "try again in a few minutes" is enough for a network
 * blip. Do NOT make this fail open: an outage would then let breached passwords through exactly
 * when nobody can notice. If the service is down for days, an owner can set the password with
 * `scripts/create-admin.ts`, which warns instead of refusing (an operator is present there).
 */
export type BreachCheck = "ok" | "breached" | "unavailable";

/** Give up waiting after this long (Better Auth's own request has no timeout). */
export const BREACH_CHECK_TIMEOUT_MS = 4000;

export async function checkPasswordBreach(
  password: string,
  /** Injectable for tests. */
  lookup: (password: string) => Promise<boolean> = isPasswordCompromised,
): Promise<BreachCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("breach check timed out")), BREACH_CHECK_TIMEOUT_MS);
    });
    const compromised = await Promise.race([lookup(password), timeout]);
    return compromised ? "breached" : "ok";
  } catch {
    return "unavailable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const BREACHED_PASSWORD_MESSAGE =
  "That password appears in known data breaches, so it is not safe to use. Choose another.";
export const BREACH_CHECK_UNAVAILABLE_MESSAGE =
  "We could not check that password against known data breaches just now. Wait a minute and try again.";
