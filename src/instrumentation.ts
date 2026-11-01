import type { Instrumentation } from "next";

import { captureException } from "@/lib/monitoring/sentry";

/**
 * Boot checks and error monitoring (plan 13). The Node-only parts live in `instrumentation-node.ts`
 * (`process.on` and the production environment check do not exist in the Edge runtime). Error
 * reporting is disabled unless SENTRY_DSN is set; see `src/lib/monitoring/sentry.ts` for the
 * reporter, the PII scrubbing and why it is not the full SDK.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    registerNode();
  }
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
