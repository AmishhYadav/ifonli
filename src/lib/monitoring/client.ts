/**
 * Browser side of error monitoring. Tiny on purpose (no SDK, no scrub code: the server scrubs again).
 * Reports go to our own `/api/monitoring` tunnel, which holds the DSN, rate limits and scrubs; the DSN
 * never reaches the browser and the CSP needs no extra origin. Capped per page load and deduplicated.
 */
export const MONITORING_ENDPOINT = "/api/monitoring";

const MAX_PER_PAGE = 5;
const seen = new Set<string>();

export function reportClientError(error: unknown, source: string): void {
  if (typeof window === "undefined" || seen.size >= MAX_PER_PAGE) return;
  const err =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const key = `${source}|${err.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  const body = JSON.stringify({
    source,
    name: err.name,
    message: err.message.slice(0, 500),
    stack: err.stack?.slice(0, 4000),
    url: `${location.pathname}${location.search}`.slice(0, 300),
  });
  try {
    if (navigator.sendBeacon?.(MONITORING_ENDPOINT, new Blob([body], { type: "application/json" })))
      return;
    void fetch(MONITORING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Monitoring must never throw.
  }
}

/** Installs window-level listeners. Returns the cleanup function. */
export function installClientErrorListeners(): () => void {
  const onError = (event: ErrorEvent) => {
    // Cross-origin "Script error." has no information and extension noise is not ours.
    if (!event.error && (!event.message || event.message === "Script error.")) return;
    reportClientError(event.error ?? event.message, "client");
  };
  const onRejection = (event: PromiseRejectionEvent) =>
    reportClientError(event.reason, "client-unhandled-rejection");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
