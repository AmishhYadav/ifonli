/**
 * Browser side of the first-party event beacon (plan 12, FR-18).
 *
 *   import { track } from "@/lib/analytics/client";
 *   track("hero_tile_click", { productId, meta: { tile: "3" } });
 *
 * Events are queued and sent in small batches: after a short delay, when the queue fills, and when the
 * page is hidden or unloaded. `navigator.sendBeacon` is used when available, else `fetch` with
 * `keepalive`. Nothing here ever throws or blocks: tracking is best effort and silent. Safe to import
 * from server-rendered modules (it does nothing without a `window`).
 */
import {
  LIMITS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  normalizePath,
  toGa4Event,
  type ClientEvent,
  type TrackProps,
  type WireEvent,
} from "./events";

const ENDPOINT = "/api/events";
const FLUSH_DELAY_MS = 3000;
const STORAGE_KEY = "ifonli_sid";

interface Ga4Window extends Window {
  gtag?: (...args: unknown[]) => void;
  /** Set by the consent-gated GA4 loader once gtag.js is ready. */
  __ifonliGa4?: boolean;
}

const queue: WireEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let memorySession: { id: string; last: number } | null = null;

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function writeSessionCookie(id: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // A session cookie (no Max-Age): random, anonymous, and gone when the browser closes.
    document.cookie = `${SESSION_COOKIE}=${id}; path=/; SameSite=Lax${secure}`;
  } catch {
    // cookies blocked
  }
}

/**
 * The anonymous session id: random, kept in `sessionStorage` (per tab), renewed after 30 idle minutes.
 * It is mirrored into a session cookie only so that placing an order can be tied to the visit.
 */
export function getSessionId(now: number = Date.now()): string {
  let stored: { id: string; last: number } | null = memorySession;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const [id, last] = raw.split(":");
      if (id && /^[A-Za-z0-9_-]{16,64}$/.test(id)) stored = { id, last: Number(last) || 0 };
    }
  } catch {
    // storage blocked: fall back to memory
  }
  const fresh = !stored || now - stored.last > SESSION_IDLE_MS;
  const id = fresh ? randomId() : stored!.id;
  memorySession = { id, last: now };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, `${id}:${now}`);
  } catch {
    // storage blocked
  }
  if (fresh) writeSessionCookie(id);
  return id;
}

function activeVibe(): string | undefined {
  const v = document.documentElement.dataset.vibe;
  return v && /^[a-z][a-z0-9-]{0,31}$/.test(v) ? v : undefined;
}

function sendBatch(events: WireEvent[]): void {
  const body = JSON.stringify({ sessionId: getSessionId(), events });
  try {
    if (typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/** Sends everything queued now. Called automatically; exported for tests and for unload handlers. */
export function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) sendBatch(queue.splice(0, LIMITS.maxBatch));
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

function mirrorToGa4(event: WireEvent): void {
  const w = window as Ga4Window;
  if (!w.__ifonliGa4 || typeof w.gtag !== "function") return;
  const call = toGa4Event(event);
  if (call) w.gtag("event", call.name, call.params);
}

/**
 * Records one event. `path` defaults to the current pathname (query and hash are never sent) and `vibe`
 * to the active vibe. Ignored on the server.
 */
export function track(event: ClientEvent, props: TrackProps = {}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const wire: WireEvent = {
      event,
      ...props,
      path: normalizePath(props.path ?? window.location.pathname),
      vibe: props.vibe ?? activeVibe(),
    };
    queue.push(wire);
    mirrorToGa4(wire);
    listen();
    if (queue.length >= LIMITS.maxBatch) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  } catch {
    // tracking must never break the page
  }
}
