import { captureException } from "@/lib/monitoring/sentry";
import { assertProductionEnv } from "@/lib/env";

/** How long a crashing process waits for its last error report to go out before exiting anyway. */
const CRASH_REPORT_TIMEOUT_MS = 2000;

/**
 * Node-runtime half of `register()` (kept in its own file so the Edge bundle never sees `process.on`).
 *  1. Fails the boot of a production server whose environment is incomplete or weak, instead of
 *     starting and sending e-mails with `localhost` links or signing sessions with a missing secret.
 *  2. With SENTRY_DSN set, reports unhandled rejections and uncaught exceptions.
 */
export function registerNode(): void {
  // `next build` runs this file too (to collect page data); the real environment is only needed at runtime.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    assertProductionEnv(process.env);
  }
  if (!process.env.SENTRY_DSN) return;
  // Promise rejections nobody awaited (fire-and-forget outbox work, webhooks) never reach onRequestError.
  process.on("unhandledRejection", (reason) => {
    void captureException(reason, { source: "unhandled-rejection" });
  });
  // Having this listener turns off Node's default crash, so after reporting the process must exit
  // itself: carrying on after an uncaught exception would run with state nobody can vouch for.
  process.on("uncaughtException", (error) => {
    const exit = () => process.exit(1);
    setTimeout(exit, CRASH_REPORT_TIMEOUT_MS).unref();
    void captureException(error, { source: "uncaught-exception" }).finally(exit);
  });
}
