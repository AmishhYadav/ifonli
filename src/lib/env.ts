import { z } from "zod";

/**
 * Validated server environment.
 *
 * Access is lazy (call `getServerEnv()`), so `next build` never fails because an optional
 * service (Razorpay, Resend, Sentry, ...) is not configured. Required-in-production values
 * are only enforced at runtime, not during the production build phase.
 */

// Treat empty strings (as in .env.example) as "not set".
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.url().optional(),
);

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: optionalString,

  // Site / auth
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: optionalUrl,

  // Supabase
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,

  // Razorpay
  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  NEXT_PUBLIC_RAZORPAY_KEY_ID: optionalString,
  /** Server-only. Exactly "1" lets the launch gate open on `rzp_test_` keys (a public demo before live KYC). */
  PAYMENTS_TEST_MODE: optionalString,

  // Email
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,

  // Internal secrets
  CRON_SECRET: optionalString,
  ORDER_TOKEN_SECRET: optionalString,

  // Observability / analytics
  SENTRY_DSN: optionalString,
  NEXT_PUBLIC_GA4_ID: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const env = serverEnvSchema.parse(source);

  const isBuildPhase = source.NEXT_PHASE === "phase-production-build";
  if (env.NODE_ENV === "production" && !isBuildPhase && !env.BETTER_AUTH_SECRET) {
    throw new Error("Invalid environment: BETTER_AUTH_SECRET is required in production");
  }
  return env;
}

/** Lazily validated, memoised server env. Throws a readable error if invalid. */
export function getServerEnv(): ServerEnv {
  if (!cached) {
    try {
      cached = parseServerEnv(process.env);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid environment variables: ${issues}`);
      }
      throw error;
    }
  }
  return cached;
}

/** Secrets shorter than this are guessable or placeholders; `openssl rand -hex 32` gives 64. */
const MIN_SECRET_LENGTH = 32;

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
] as const;
/**
 * Not required to boot: until live KYC is approved the site runs with no Razorpay keys and the launch
 * gate keeps orders closed. All-or-nothing though: setting any of them means all three must be set.
 */
const RAZORPAY_VARS = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const;
const STRONG_SECRETS = ["BETTER_AUTH_SECRET", "CRON_SECRET"] as const;

/**
 * What is wrong with a production environment, as readable lines (never values). A site URL has to
 * be https, except for localhost, so a production build can still be run and tested on one machine.
 */
export function productionEnvProblems(source: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const get = (name: string) => source[name]?.trim() ?? "";

  const siteUrl = get("NEXT_PUBLIC_SITE_URL");
  if (!siteUrl) {
    problems.push("NEXT_PUBLIC_SITE_URL is not set (links in e-mails, the sitemap and canonical URLs would point at localhost)");
  } else {
    try {
      const url = new URL(siteUrl);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
        problems.push("NEXT_PUBLIC_SITE_URL must be an https:// URL");
      }
    } catch {
      problems.push("NEXT_PUBLIC_SITE_URL is not a valid URL");
    }
  }
  for (const name of STRONG_SECRETS) {
    const value = get(name);
    if (!value) problems.push(`${name} is not set`);
    else if (value.length < MIN_SECRET_LENGTH) problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  for (const name of REQUIRED_IN_PRODUCTION) {
    if (!get(name)) problems.push(`${name} is not set`);
  }
  if (RAZORPAY_VARS.some((name) => get(name))) {
    for (const name of RAZORPAY_VARS) {
      if (!get(name)) problems.push(`${name} is not set (Razorpay is half configured: set all of ${RAZORPAY_VARS.join(", ")}, or none of them)`);
    }
  }
  return problems;
}

/** Throws one error listing everything wrong, so a bad deploy fails at boot and says why. */
export function assertProductionEnv(source: Record<string, string | undefined>): void {
  const problems = productionEnvProblems(source);
  if (problems.length > 0) {
    throw new Error(`Invalid production environment:\n - ${problems.join("\n - ")}`);
  }
}
