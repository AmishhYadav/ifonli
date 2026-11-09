/**
 * Client-side vibe store over `html[data-vibe]`. The attribute is the single source of truth, so the
 * head script, the hand button and any other writer stay in sync. DOM access is guarded so the module
 * is safe to import on the server.
 */
import {
  DEFAULT_VIBE,
  MIX_ATTRIBUTE,
  VIBE_CHANGE_EVENT,
  VIBE_COOKIE,
  VIBE_COOKIE_MAX_AGE,
  VIBE_NAMES,
  VIBE_STORAGE_KEY,
  VIBE_URL_PARAM,
  isVibe,
  type Vibe,
} from "./config";

/**
 * Who changed the vibe: the hand, a nav pill / mobile-menu link (`nav`), arriving on a `/vibes/<slug>` page
 * (`page`), a shared `?vibe=` link (`url`), a scope, the first-load restore (`init`) or code (`api`).
 */
export type VibeSource = "hand" | "nav" | "page" | "url" | "scope" | "init" | "api";

export interface SetVibeOptions {
  source: VibeSource;
  /** performance.now() timestamp of the user action; durationMs is measured from here. */
  startedAt?: number;
  /** durationMs is measured until this settles (e.g. the view transition's `finished`). */
  settled?: PromiseLike<unknown>;
  usedViewTransition?: boolean;
}

export interface VibeChangeDetail {
  from: Vibe;
  to: Vibe;
  durationMs: number;
  usedViewTransition: boolean;
  source: VibeSource;
}

declare global {
  interface Window {
    __ifonliVibe?: { last?: VibeChangeDetail };
  }
}

const exposeForTests =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export function getVibe(): Vibe {
  if (typeof document === "undefined") return DEFAULT_VIBE;
  const value = document.documentElement.dataset.vibe;
  return isVibe(value) ? value : DEFAULT_VIBE;
}

export function getServerVibe(): Vibe {
  return DEFAULT_VIBE;
}

export function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-vibe"] });
  return () => observer.disconnect();
}

/** Put `?vibe=<vibe>` on the current URL without navigating. Keeps path, hash, history.state and other params. */
export function syncUrl(vibe: Vibe): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get(VIBE_URL_PARAM) === vibe) return;
  url.searchParams.set(VIBE_URL_PARAM, vibe);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

function persist(vibe: Vibe): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${VIBE_COOKIE}=${vibe}; max-age=${VIBE_COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
  } catch {
    // cookies blocked
  }
  try {
    window.localStorage.setItem(VIBE_STORAGE_KEY, vibe);
  } catch {
    // storage blocked
  }
}

function updateThemeColor(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = bg;
}

function announce(vibe: Vibe): void {
  const region = document.getElementById("vibe-live");
  if (region) region.textContent = `Vibe changed to ${VIBE_NAMES[vibe]}`;
}

/**
 * While a switch runs, `html[data-vibe-switching]` turns every colour/background/border transition off (vibe.css), so
 * each element, including ones the browser skips (content-visibility on the footer, off-screen subtrees), computes the
 * new theme at once instead of starting a 0.32s transition that may never finish. Cleared two frames after the
 * switch settles; a newer switch keeps it on until its own end.
 */
let switchToken = 0;
function beginSwitch(settled: PromiseLike<unknown> | undefined): void {
  const root = document.documentElement;
  const token = ++switchToken;
  root.setAttribute("data-vibe-switching", "");
  const end = () => {
    if (token !== switchToken) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token === switchToken) root.removeAttribute("data-vibe-switching");
      }),
    );
  };
  Promise.resolve(settled).then(end, end);
}

/**
 * Content the browser skips (`below-fold` = content-visibility: auto) only resolves its style when it is first
 * rendered, which would be after the switch ended and transitions are back on: it would then ease from the old
 * theme's colours. Reading a computed style makes the browser resolve it now, while transitions are still off.
 */
function flushSkippedStyles(): void {
  for (const el of document.querySelectorAll(".below-fold, .below-fold *")) void getComputedStyle(el).color;
}

/** Apply a vibe: attribute, theme-color, cookie, localStorage, URL, live region, change event. */
export function setVibe(to: Vibe, options: SetVibeOptions): void {
  if (typeof document === "undefined") return;
  const from = getVibe();
  const startedAt = options.startedAt ?? performance.now();

  // Turning the hand is an explicit "show me this mood": the neutral home theme steps aside until the visitor
  // navigates (MixMode puts it back on the next route change, so the home page starts mixed again).
  if (options.source === "hand") document.documentElement.removeAttribute(MIX_ATTRIBUTE);
  if (from !== to) beginSwitch(options.settled);
  document.documentElement.dataset.vibe = to;
  if (from !== to) flushSkippedStyles();
  updateThemeColor();
  persist(to);
  syncUrl(to);
  if (options.source !== "init") announce(to);
  if (from === to) return;

  const finish = () => {
    const end = performance.now();
    const detail: VibeChangeDetail = {
      from,
      to,
      durationMs: Math.round((end - startedAt) * 10) / 10,
      usedViewTransition: options.usedViewTransition ?? false,
      source: options.source,
    };
    try {
      performance.measure("vibe-switch", { start: startedAt, end });
    } catch {
      // measure options unsupported
    }
    if (exposeForTests) window.__ifonliVibe = { last: detail };
    window.dispatchEvent(new CustomEvent<VibeChangeDetail>(VIBE_CHANGE_EVENT, { detail }));
  };
  Promise.resolve(options.settled).then(finish, finish);
}
