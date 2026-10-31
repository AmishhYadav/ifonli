import type { Instrumentation } from "next";

import { captureException } from "@/lib/monitoring/sentry";

/**
 * Error monitoring entry point (plan 13). Disabled unless SENTRY_DSN is set; see
 * `src/lib/monitoring/sentry.ts` for the reporter, the PII scrubbing and why it is not the full SDK.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  // Promise rejections nobody awaited (fire-and-forget outbox work, webhooks) never reach onRequestError.
  process.on("unhandledRejection", (reason) => {
    void captureException(reason, { source: "unhandled-rejection" });
  });
  process.on("uncaughtException", (error) => {
    void captureException(error, { source: "uncaught-exception" });
  });
}

/** Every error Next.js catches while rendering, in Route Handlers, Server Actions and the proxy. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest)
      : undefined;
  await captureException(error, {
    source: context.routeType === "render" ? `server-${context.renderSource}` : context.routeType,
    route: context.routePath,
    url: request.path,
    method: request.method,
    ...(digest ? { digest } : {}),
    tags: { router: context.routerKind },
  });
};
