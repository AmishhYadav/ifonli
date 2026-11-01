/**
 * "Did the visitor reach this page from another page of this storefront, in this tab?" Used by the PDP Back
 * button to decide between `router.back()` (the listing returns with its filters and scroll position) and a
 * fallback link (arrived from a search engine, a message, a bookmark or a new tab).
 *
 * Why not just `document.referrer` + `history.length`? `document.referrer` is fixed for the document: after a
 * client-side navigation it still names whoever sent the visitor to the FIRST page (Google, say), so it would
 * wrongly say "not in-app" on every soft navigation, and `history.length` also counts entries from before the
 * storefront. So the flag is tracked: it is seeded once per document load from the referrer (same origin
 * means the previous page was ours), then set the moment the router changes the pathname. A reload or a
 * back/forward load keeps the stored answer (sessionStorage is per tab). `hasInAppPrevious()` also requires
 * `history.length > 1`, because a page opened in a new tab (target=_blank) has a same-origin referrer but
 * nothing to go back to.
 */

const KEY = "ifonli_inapp";

let inApp = false;
let seeded = false;

function store(value: boolean): void {
  inApp = value;
  try {
    window.sessionStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // storage blocked: the in-memory flag still works until the next full load
  }
}

function sameOriginReferrer(): boolean {
  if (!document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Seed the flag for this document load. Idempotent. */
export function seedInAppHistory(): void {
  if (seeded) return;
  seeded = true;
  const navType = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type;
  if (navType === "reload" || navType === "back_forward") {
    try {
      inApp = window.sessionStorage.getItem(KEY) === "1";
      return;
    } catch {
      // fall through to the referrer
    }
  }
  store(sameOriginReferrer());
}

/** The router moved to another page of the storefront: there is an in-app page behind this one. */
export function markInAppNavigation(): void {
  seedInAppHistory();
  store(true);
}

export function hasInAppPrevious(): boolean {
  seedInAppHistory();
  return inApp && window.history.length > 1;
}
