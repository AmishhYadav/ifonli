type Ga4Window = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  __ifonliGa4?: boolean;
} & Record<`ga-disable-${string}`, boolean | undefined>;

const SCRIPT_ID = "ifonli-ga4";

/**
 * Loads gtag.js. Call only after consent. Page views are sent by our own `track()` mirror (so each one
 * has the same clean path as the first-party table), hence `send_page_view: false`.
 */
export function loadGa4(id: string): void {
  const w = window as unknown as Ga4Window;
  w[`ga-disable-${id}`] = false;
  if (document.getElementById(SCRIPT_ID)) {
    w.__ifonliGa4 = true;
    return;
  }
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js reads `arguments` objects from the data layer, not arrays.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  w.gtag("config", id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
  w.__ifonliGa4 = true;
}

/** Stops sending (a loaded gtag.js cannot be unloaded, but Google's documented opt-out flag silences it). */
export function disableGa4(id: string): void {
  const w = window as unknown as Ga4Window;
  w[`ga-disable-${id}`] = true;
  w.__ifonliGa4 = false;
}
