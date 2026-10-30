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
