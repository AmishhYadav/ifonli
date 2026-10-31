/**
 * Minimal, dependency-free error reporter that speaks Sentry's envelope HTTP API.
 *
 * Why not @sentry/nextjs: it wraps next.config with a webpack/Turbopack plugin, patches the request
 * pipeline (tracing helpers that touch time/randomness during prerender, a known friction point with
 * Cache Components), and adds roughly 40+ KB gzip to the client against a 150 KB budget. We only need
 * "tell me when something throws, without PII", so this sends one `event` item per error, scrubbed,
 * and is a complete no-op unless SENTRY_DSN is set. See docs/DECISIONS.md D-OPS-1; swapping in the
 * official SDK later only means replacing `captureException` / `onRequestError` wiring.
 *
 * Works in the Node and Edge runtimes (fetch + Web Crypto only).
 */
import { parseStack, scrubText, scrubUrl, type ScrubbedFrame } from "./scrub";

export interface ParsedDsn {
  /** https://host/api/<project>/envelope/ */
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** Parses `https://<public key>@<host>[/prefix]/<project id>`. Returns null for anything invalid. */
export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn?.trim()) return null;
  try {
    const url = new URL(dsn.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const publicKey = url.username;
    const segments = url.pathname.split("/").filter(Boolean);
    const project = segments.pop();
    if (!publicKey || !project || !/^\d+$/.test(project)) return null;
    const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
    return {
      envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
      publicKey,
      dsn: `${url.protocol}//${publicKey}@${url.host}${prefix}/${project}`,
    };
  } catch {
    return null;
  }
}

export interface ErrorContext {
  /** Where it happened: "server-render", "route", "action", "client", "client-boundary", "cron"... */
  source: string;
  /** Route template ("/orders/[ref]"), never the concrete path. */
  route?: string;
  /** Concrete path or URL; scrubbed before sending (query values and order refs removed). */
  url?: string;
  method?: string;
  /** Next.js error digest (a hash, safe to send). */
  digest?: string;
  /** Extra low-cardinality tags (no personal data!). */
  tags?: Record<string, string>;
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: "node" | "javascript";
  level: "error" | "warning";
  release?: string;
  environment: string;
  transaction?: string;
  tags: Record<string, string>;
  request?: { url: string; method?: string };
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: ScrubbedFrame[] };
    }>;
  };
  sdk: { name: string; version: string };
}

export interface ReporterEnv {
  dsn?: string | undefined;
  release?: string | undefined;
  environment?: string | undefined;
}

export function readReporterEnv(
  env: Record<string, string | undefined> = process.env,
): ReporterEnv {
  return {
    dsn: env["SENTRY_DSN"],
    release: env["VERCEL_GIT_COMMIT_SHA"] || undefined,
    environment: env["VERCEL_ENV"] || env["NODE_ENV"] || "development",
  };
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function describe(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  if (typeof error === "string") return { type: "Error", message: error };
  try {
    return { type: "Error", message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { type: "Error", message: "Unserialisable error value" };
  }
}

/** Builds a scrubbed event. Pure: exported for tests. */
export function buildEvent(
  error: unknown,
  context: ErrorContext,
  env: ReporterEnv,
  runtime: "node" | "javascript" = "node",
  now: Date = new Date(),
): SentryEvent {
  const { type, message, stack } = describe(error);
  const frames = parseStack(stack);
  const tags: Record<string, string> = { source: context.source };
  if (context.route) tags["route"] = scrubUrl(context.route).slice(0, 120);
  if (context.digest) tags["digest"] = context.digest.slice(0, 32);
  for (const [k, v] of Object.entries(context.tags ?? {})) tags[k.slice(0, 32)] = scrubText(v, 80);

  return {
    event_id: eventId(),
    timestamp: now.getTime() / 1000,
    platform: runtime,
    level: "error",
    ...(env.release ? { release: env.release } : {}),
    environment: env.environment ?? "production",
    ...(context.route ? { transaction: scrubUrl(context.route).slice(0, 120) } : {}),
    tags,
    ...(context.url
      ? {
          request: {
            url: scrubUrl(context.url),
            ...(context.method ? { method: context.method.slice(0, 10) } : {}),
          },
        }
      : {}),
    exception: {
      values: [
        {
          type: scrubText(type, 80),
          value: scrubText(message),
          ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
        },
      ],
    },
    sdk: { name: "ifonli.minimal-reporter", version: "1.0.0" },
  };
}

/** Serialises an event as a Sentry envelope (three newline-separated JSON documents). */
export function buildEnvelope(event: SentryEvent, dsn: string, sentAt: Date = new Date()): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString(), dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

const SEND_TIMEOUT_MS = 2500;
/** Identical errors within this window are sent once per instance (a failing loop must not flood Sentry). */
const DEDUPE_MS = 60_000;
const recent = new Map<string, number>();

function shouldSend(event: SentryEvent): boolean {
  const first = event.exception.values[0];
  const key = `${event.tags["route"] ?? ""}|${first?.type}|${first?.value}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return false;
  if (recent.size > 200) recent.clear();
  recent.set(key, now);
  return true;
}

/**
 * Sends an error to Sentry. No-op (resolves false) without SENTRY_DSN. Never throws: monitoring
 * must not be able to break a request. Await it where the platform may freeze the function right
 * after the response (onRequestError); it is bounded by a 2.5 s timeout.
 */
export async function captureException(
  error: unknown,
  context: ErrorContext,
  runtime: "node" | "javascript" = "node",
  env: ReporterEnv = readReporterEnv(),
): Promise<boolean> {
  const dsn = parseDsn(env.dsn);
  if (!dsn) return false;
  try {
    const event = buildEvent(error, context, env, runtime);
    if (!shouldSend(event)) return false;
    const response = await fetch(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=ifonli.minimal-reporter/1.0.0, sentry_key=${dsn.publicKey}`,
      },
      body: buildEnvelope(event, dsn.dsn),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
