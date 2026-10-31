import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  type ConsentChoice,
} from "@/lib/analytics/events";

/** Parses the consent cookie value; anything unexpected counts as "no choice yet". */
export function parseConsent(value: string | null | undefined): ConsentChoice | null {
  return value === "granted" || value === "denied" ? value : null;
}

export function readConsent(cookieString: string = typeof document === "undefined" ? "" : document.cookie): ConsentChoice | null {
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CONSENT_COOKIE) return parseConsent(rest.join("="));
  }
  return null;
}

/** Stores the visitor's choice for 180 days. The cookie holds one word and no personal data. */
export function writeConsent(choice: ConsentChoice): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${choice}; max-age=${CONSENT_MAX_AGE_SECONDS}; path=/; SameSite=Lax${secure}`;
  } catch {
    // cookies blocked: the choice only lasts for this page view
  }
}

/**
 * Whether the optional GA4 may load: an id must exist, and either consent is not required
 * (owner setting) or the visitor said yes.
 */
export function shouldLoadGa4(input: {
  ga4Id: string | null;
  consentRequired: boolean;
  choice: ConsentChoice | null;
}): boolean {
  if (!input.ga4Id) return false;
  return input.consentRequired ? input.choice === "granted" : input.choice !== "denied";
}

/** The banner shows only when GA4 is configured and consent is required and nothing was chosen. */
export function shouldShowBanner(input: {
  ga4Id: string | null;
  consentRequired: boolean;
  choice: ConsentChoice | null;
}): boolean {
  return Boolean(input.ga4Id) && input.consentRequired && input.choice === null;
}

/** "unknown" = not on the client yet (server render / hydration); "none" = the visitor has not chosen. */
export type ConsentSnapshot = ConsentChoice | "none" | "unknown";

const listeners = new Set<() => void>();

/** `useSyncExternalStore` source over the consent cookie. */
export const consentStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ConsentSnapshot {
    return readConsent() ?? "none";
  },
  getServerSnapshot(): ConsentSnapshot {
    return "unknown";
  },
  set(choice: ConsentChoice): void {
    writeConsent(choice);
    for (const l of listeners) l();
  },
};
