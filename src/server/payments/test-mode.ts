import "server-only";

type Env = Record<string, string | undefined>;

/**
 * True when the active payment provider is Razorpay on test keys (`rzp_test_`), so checkout can say that
 * no real money is charged. False for live keys and for the dev mock (no keys; it has its own dev
 * dialog). Only a boolean leaves the server: never the key id or secret.
 */
export function isRazorpayTestMode(env: Env): boolean {
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? "";
  const secret = env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  return keyId.startsWith("rzp_test_") && secret.length > 0;
}
