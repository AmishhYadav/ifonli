/**
 * Security response headers and the Content-Security-Policy (plan 13). Pure and dependency-free so
 * `next.config.ts` can import it (relative path, no `@/` alias) and unit tests can cover it.
 *
 * Why a STATIC policy (and not a per-request nonce):
 *  - Next.js can only put a nonce on the inline bootstrap / flight-data scripts of a dynamically
 *    rendered response. With Cache Components + PPR the static shell is built once, with no request,
 *    so a nonce policy would force every page dynamic (no CDN cache, no static shells) and the shell's
 *    inline scripts would still be blocked. The experimental SRI mode only covers external files; the
 *    inline `self.__next_f.push(...)` chunks and our no-flash VibeHeadScript stay inline.
 *  - So script-src allows `'unsafe-inline'`, and the rest of the policy does the heavy lifting:
 *    no eval in production, a fixed allow-list of third-party origins, `object-src 'none'`,
 *    `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, a tight `connect-src`.
 *    Output is escaped by React; JSON-LD and the vibe script are built from trusted data only.
 *  - Revisit hash/nonce CSP when Next supports it for static shells (see docs/DECISIONS.md D-SEC-1).
 *
 * Modes (`CSP_MODE`): `report-only` (default) sends the full policy as Content-Security-Policy-Report-Only
 * and always enforces a small baseline (framing, plugins, base-uri); `enforce` enforces the full policy.
 */

export type CspMode = "report-only" | "enforce";

export interface SecurityHeaderOptions {
  /** `process.env.NODE_ENV === "production"`. HSTS, no-eval and upgrade-insecure-requests depend on it. */
  production: boolean;
  /** `report-only` or `enforce`. Anything else falls back to `report-only`. */
  mode?: string | undefined;
  /** Public site origin, e.g. https://ifonli.in. `https:` turns on upgrade-insecure-requests. */
  siteUrl?: string | undefined;
  /** Supabase project URL (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL): storage images and media. */
  supabaseUrl?: string | undefined;
  /** GA4 measurement id. When set the Google Tag Manager / Analytics origins are allowed. */
  ga4Id?: string | undefined;
  /** Where violation reports go. Same-origin path. */
  reportPath?: string;
}

export interface HeaderEntry {
  key: string;
  value: string;
}

/** Razorpay Checkout.js origins (verify against https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/ at launch). */
export const RAZORPAY = {
  script: ["https://checkout.razorpay.com"],
  frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: [
    "https://api.razorpay.com",
    "https://checkout.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://lumberjack-metrics.razorpay.com",
  ],
  img: ["https://cdn.razorpay.com", "https://checkout.razorpay.com"],
} as const;

const GA_SCRIPT = ["https://www.googletagmanager.com"];
const GA_CONNECT = [
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
];
const GA_IMG = [
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://www.googletagmanager.com",
];

export const CSP_REPORT_PATH = "/api/csp-report";

export function resolveCspMode(value: string | undefined): CspMode {
  return value?.trim().toLowerCase() === "enforce" ? "enforce" : "report-only";
}

/** `scheme://host[:port]` of a URL, or null when it is not a valid http(s) URL. */
export function originOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Baseline that is safe on every page and is enforced in both modes. */
export function buildBaselinePolicy(): string {
  return ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].join("; ");
}

/** The full policy. */
export function buildContentSecurityPolicy(options: SecurityHeaderOptions): string {
  const { production } = options;
  const supabase = originOf(options.supabaseUrl);
  const ga = !!options.ga4Id?.trim();
  const report = options.reportPath ?? CSP_REPORT_PATH;
  const httpsSite = originOf(options.siteUrl)?.startsWith("https:") ?? false;

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(production ? [] : ["'unsafe-eval'"]), // React dev tooling only; never in production
    ...RAZORPAY.script,
    ...(ga ? GA_SCRIPT : []),
  ];
  const connectSrc = [
    "'self'",
    // Browser uploads PUT straight to Supabase Storage signed URLs (admin product and banner images,
    // customer support photos).
    ...(supabase ? [supabase] : []),
    ...RAZORPAY.connect,
    ...(ga ? GA_CONNECT : []),
    ...(production ? [] : ["ws://localhost:*", "ws://127.0.0.1:*"]), // HMR
  ];
  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    ...(supabase ? [supabase] : []),
    ...RAZORPAY.img,
    ...(ga ? GA_IMG : []),
  ];

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    `media-src 'self' blob: data:${supabase ? ` ${supabase}` : ""}`,
    `frame-src ${RAZORPAY.frame.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${report}`,
    "report-to csp",
  ];
  if (production && httpsSite) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Permissions-Policy: powerful features off; `payment` only for us and the Razorpay frames. */
export function buildPermissionsPolicy(): string {
  const razorpay = RAZORPAY.frame.map((o) => `"${o}"`).join(" ");
  return [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "usb=()",
    "browsing-topics=()",
    `payment=(self ${razorpay})`,
  ].join(", ");
}

/** Headers for every route. */
export function buildSecurityHeaders(options: SecurityHeaderOptions): HeaderEntry[] {
  const mode = resolveCspMode(options.mode);
  const report = options.reportPath ?? CSP_REPORT_PATH;
  const full = buildContentSecurityPolicy(options);

  const headers: HeaderEntry[] =
    mode === "enforce"
      ? [{ key: "Content-Security-Policy", value: full }]
      : [
          { key: "Content-Security-Policy", value: buildBaselinePolicy() },
          { key: "Content-Security-Policy-Report-Only", value: full },
        ];

  headers.push(
    { key: "Reporting-Endpoints", value: `csp="${report}"` },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: buildPermissionsPolicy() },
    // Keeps window.opener for popups we open (Razorpay redirect/3DS flows) while isolating us from others.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-DNS-Prefetch-Control", value: "on" },
  );
  if (options.production) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}

/** Pages that carry an order token or order data: never leak the URL in a Referer header. */
export const NO_REFERRER_SOURCES = ["/orders/:path*", "/track", "/track/:path*"] as const;
