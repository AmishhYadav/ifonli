import "server-only";

import { and, asc, eq, inArray, like, sql } from "drizzle-orm";

import { renderTemplate } from "@/server/content/render-template";
import { POLICY_SLUGS, loadTemplateContext } from "@/server/content/policies";
import { faqs, policies, productImages, products, variants, vibes } from "@/server/db/schema";
import { getHeroTilesForAllVibes } from "@/server/services/catalog";
import type { DbClient } from "@/server/services/queries/shared";
import { readSettings } from "@/server/services/queries/shared";
import {
  SETTINGS,
  SETTING_KEYS,
  isRequiredForLaunch,
  type SettingKey,
} from "@/server/services/settings-registry";

import { HERO_TILES_MIN } from "./featured";
import { POLICY_TITLES } from "./policies";

/**
 * Launch gate (plan section 14). One call answers "can the shop take real orders?" and lists, with a link
 * to the fix, everything that is not ready:
 *  - settings still flagged `PLACEHOLDER` that are required for launch,
 *  - active products that still use placeholder images / SKUs,
 *  - policies that are missing, unpublished or still have unresolved / placeholder tokens,
 *  - production environment (Razorpay live keys, Resend, secrets, site URL),
 *  - warnings (not blockers): thin hero sets, FAQ answers hidden by tokens, optional services.
 * `ready` is true when there are no blockers.
 */

export type LaunchCategory = "settings" | "products" | "policies" | "environment" | "content";
export type LaunchSeverity = "blocker" | "warning";

export interface LaunchItem {
  id: string;
  category: LaunchCategory;
  severity: LaunchSeverity;
  title: string;
  detail?: string;
  /** Where to fix it; null when it is not fixable inside the admin (environment variables). */
  href: string | null;
  /** More places to look (the affected products, one per line). */
  links?: { label: string; href: string }[];
}

export interface LaunchReadiness {
  ready: boolean;
  blockers: number;
  warnings: number;
  items: LaunchItem[];
  categories: { id: LaunchCategory; label: string; blockers: number; warnings: number }[];
  checkedAt: Date;
}

export const LAUNCH_CATEGORY_LABELS: Record<LaunchCategory, string> = {
  settings: "Store settings",
  products: "Products and images",
  policies: "Policies",
  environment: "Production environment",
  content: "Content",
};

type Env = Record<string, string | undefined>;

const present = (v: string | undefined) => (v ?? "").trim().length > 0;

/**
 * True for a build made with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`. Next inlines that value at build time only
 * for the literal `process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES`, never through a variable, so the real
 * environment must be read this way or a review build started without the flag looks like a normal one.
 * An explicit `env` (tests) is read as given.
 */
export function devPagesEnabled(env: Env): boolean {
  if (env === process.env) return process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
  return env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
}

/** Environment checks (pure). Everything here is configured in the hosting dashboard, not in the admin. */
export function checkEnvironment(env: Env): LaunchItem[] {
  const items: LaunchItem[] = [];
  const add = (id: string, severity: LaunchSeverity, title: string, detail: string) =>
    items.push({ id: `env:${id}`, category: "environment", severity, title, detail, href: null });

  const keyId = env.RAZORPAY_KEY_ID?.trim();
  if (!keyId || !present(env.RAZORPAY_KEY_SECRET)) {
    add(
      "razorpay",
      "blocker",
      "Razorpay live keys are missing",
      "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the live keys (after KYC approval).",
    );
  } else if (keyId.startsWith("rzp_test_") && env.PAYMENTS_TEST_MODE === "1") {
    add(
      "razorpay",
      "warning",
      "Razorpay is in test mode",
      "PAYMENTS_TEST_MODE=1 lets the store take orders on rzp_test_ keys. No real money is collected. When live KYC is approved, switch RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to rzp_live_ keys and remove PAYMENTS_TEST_MODE.",
    );
  } else if (!keyId.startsWith("rzp_live_")) {
    add(
      "razorpay",
      "blocker",
      "Razorpay is using test keys",
      "RAZORPAY_KEY_ID must start with rzp_live_ before real customers pay.",
    );
  }
  if (env.PAYMENTS_TEST_MODE === "1" && keyId?.startsWith("rzp_live_")) {
    add(
      "payments-test-mode",
      "warning",
      "PAYMENTS_TEST_MODE is set with live keys",
      "PAYMENTS_TEST_MODE has no effect with rzp_live_ keys. Remove it from the production environment.",
    );
  }
  if (!present(env.RAZORPAY_WEBHOOK_SECRET)) {
    add(
      "razorpay-webhook",
      "blocker",
      "Razorpay webhook secret is missing",
      "Set RAZORPAY_WEBHOOK_SECRET (a different secret from the key secret) and register the webhook URL.",
    );
  }
  if (!present(env.RESEND_API_KEY) && !present(env.BREVO_API_KEY)) {
    add(
      "resend",
      "blocker",
      "Email API key is missing",
      "Set BREVO_API_KEY (or RESEND_API_KEY) so order emails are delivered.",
    );
  }
  if (!present(env.EMAIL_FROM)) {
    add(
      "email-from",
      "blocker",
      "Sender address is missing",
      "Set EMAIL_FROM to a sender verified in Brevo (e.g. IfOnli <shop.ifonli@gmail.com>) or an address on the verified Resend domain.",
    );
  }
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    add(
      "auth-secret",
      "blocker",
      "Sign-in secret is missing or too short",
      "Set BETTER_AUTH_SECRET to at least 32 random characters (openssl rand -hex 32).",
    );
  }
  if (!present(env.CRON_SECRET)) {
    add(
      "cron",
      "blocker",
      "Cron secret is missing",
      "Set CRON_SECRET so Vercel Cron can call the reservation and notification jobs.",
    );
  }
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site || !/^https:\/\//i.test(site) || /localhost|127\.0\.0\.1/.test(site)) {
    add(
      "site-url",
      "blocker",
      "Public site URL is not a production https URL",
      "Set NEXT_PUBLIC_SITE_URL to the live domain (https://...).",
    );
  }
  if (!present(env.SUPABASE_URL) || !present(env.SUPABASE_SERVICE_ROLE_KEY)) {
    add(
      "storage",
      "blocker",
      "Image storage is not configured",
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so product and banner images can be uploaded.",
    );
  }
  if (env.NODE_ENV === "production") {
    if (env.CSP_MODE?.trim() !== "enforce") {
      add(
        "csp-mode",
        "blocker",
        "The content security policy is not enforced",
        "Set CSP_MODE=enforce once the report-only period shows no violations. The default only reports.",
      );
    }
    if (devPagesEnabled(env)) {
      add(
        "dev-pages",
        "blocker",
        "Review pages are switched on",
        "NEXT_PUBLIC_ENABLE_DEV_PAGES=1 exposes /styleguide, /dev/*, the email preview and unpublished policies, and switches the order gate off. Remove it from the production environment.",
      );
    }
  }
  if (!present(env.SENTRY_DSN)) {
    add(
      "sentry",
      "warning",
      "Error monitoring is off",
      "Set SENTRY_DSN to be told about production errors.",
    );
  }
  if (env.NODE_ENV !== "production") {
    add(
      "node-env",
      "warning",
      "This server is not running in production mode",
      "These checks reflect the environment this page is served from.",
    );
  }
  return items;
}

const ACTIVE_PRODUCT_SAMPLE = 8;

export async function getLaunchReadiness(
  db: DbClient,
  opts: {
    env?: Env;
    now?: Date;
    /**
     * Only work out the blockers: skips the content warnings (FAQ answers, hero sets), which are the
     * costly part. The order gate uses this on every cold start of its cache.
     */
    blockersOnly?: boolean;
  } = {},
): Promise<LaunchReadiness> {
  const env = opts.env ?? (process.env as Env);
  const now = opts.now ?? new Date();
  const items: LaunchItem[] = [];

  // ---- settings ---------------------------------------------------------------------------------
  const readings = await readSettings(db, SETTING_KEYS);
  const valueOf = (key: string) =>
    key in readings ? readings[key as SettingKey].value : undefined;
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key];
    if (!readings[key].isPlaceholder || !isRequiredForLaunch(def, valueOf)) continue;
    items.push({
      id: `setting:${key}`,
      category: "settings",
      severity: "blocker",
      title: def.label.replace(/\s*\(paise\)/i, ""),
      detail: "Still a placeholder: set the real value.",
      href: `/admin/settings?group=${def.group}#setting-${key}`,
    });
  }

  // ---- products ---------------------------------------------------------------------------------
  const [{ n: activeCount } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.status, "active"));
  if (activeCount === 0) {
    items.push({
      id: "products:none",
      category: "products",
      severity: "blocker",
      title: "No active products",
      detail: "Publish at least one product before launch.",
      href: "/admin/products",
    });
  }
  const placeholderImages = await db
    .select({
      productId: products.id,
      name: products.name,
      kind: productImages.kind,
    })
    .from(productImages)
    .innerJoin(products, eq(productImages.productId, products.id))
    .where(and(eq(productImages.isPlaceholder, true), eq(products.status, "active")))
    .orderBy(asc(products.name));
  const phProducts = new Map<string, string>();
  for (const r of placeholderImages) phProducts.set(r.productId, r.name);
  if (phProducts.size > 0) {
    const photos = placeholderImages.filter((r) => r.kind === "photo").length;
    const cutouts = placeholderImages.filter((r) => r.kind === "cutout").length;
    items.push({
      id: "products:placeholder-images",
      category: "products",
      severity: "blocker",
      title: `${phProducts.size} active ${phProducts.size === 1 ? "product uses" : "products use"} placeholder images`,
      detail: `${cutouts} placeholder ${cutouts === 1 ? "cutout" : "cutouts"} and ${photos} placeholder ${photos === 1 ? "photo" : "photos"}. Replace them with real photography.`,
      href: "/admin/products",
      links: [...phProducts]
        .slice(0, ACTIVE_PRODUCT_SAMPLE)
        .map(([id, name]) => ({ label: name, href: `/admin/products/${id}` })),
    });
  }
  const placeholderSkus = await db
    .selectDistinct({ productId: products.id, name: products.name })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .where(and(like(variants.sku, "PH-%"), eq(products.status, "active")))
    .orderBy(asc(products.name));
  if (placeholderSkus.length > 0) {
    items.push({
      id: "products:placeholder-skus",
      category: "products",
      severity: "blocker",
      title: `${placeholderSkus.length} active ${placeholderSkus.length === 1 ? "product has" : "products have"} placeholder SKUs (PH-)`,
      detail: "These come from the dev seed. Replace them with the real catalogue.",
      href: "/admin/products",
      links: placeholderSkus
        .slice(0, ACTIVE_PRODUCT_SAMPLE)
        .map((p) => ({ label: p.name, href: `/admin/products/${p.productId}` })),
    });
  }

  // ---- policies ---------------------------------------------------------------------------------
  const ctx = await loadTemplateContext(db);
  const policyRows = await db
    .select()
    .from(policies)
    .where(inArray(policies.slug, [...POLICY_SLUGS]));
  for (const slug of POLICY_SLUGS) {
    const row = policyRows.find((p) => p.slug === slug);
    const title = row?.title ?? POLICY_TITLES[slug];
    const href = `/admin/policies/${slug}`;
    if (!row) {
      items.push({
        id: `policy:${slug}`,
        category: "policies",
        severity: "blocker",
        title: `${title} does not exist yet`,
        detail: "Create the draft and publish it.",
        href,
      });
    } else if (!row.published) {
      items.push({
        id: `policy:${slug}`,
        category: "policies",
        severity: "blocker",
        title: `${title} is not published`,
        detail: "The owner publishes it after legal review.",
        href,
      });
    } else {
      const { problems } = renderTemplate(row.bodyMd, ctx);
      if (problems.length > 0) {
        items.push({
          id: `policy:${slug}`,
          category: "policies",
          severity: "blocker",
          title: `${title} has unresolved settings`,
          detail: `${problems.length} ${problems.length === 1 ? "token is" : "tokens are"} a placeholder or missing (${problems
            .slice(0, 3)
            .map((p) => p.token)
            .join(
              ", ",
            )}${problems.length > 3 ? ", ..." : ""}); the page is hidden on the live site until fixed.`,
          href,
        });
      }
    }
  }

  // ---- content (warnings only) -------------------------------------------------------------------
  if (!opts.blockersOnly) await addContentWarnings(db, items, ctx, now);

  // ---- environment ------------------------------------------------------------------------------
  items.push(...checkEnvironment(env));

  const blockers = items.filter((i) => i.severity === "blocker").length;
  const warnings = items.length - blockers;
  return {
    ready: blockers === 0,
    blockers,
    warnings,
    items,
    categories: (Object.keys(LAUNCH_CATEGORY_LABELS) as LaunchCategory[]).map((id) => ({
      id,
      label: LAUNCH_CATEGORY_LABELS[id],
      blockers: items.filter((i) => i.category === id && i.severity === "blocker").length,
      warnings: items.filter((i) => i.category === id && i.severity === "warning").length,
    })),
    checkedAt: now,
  };
}

async function addContentWarnings(
  db: DbClient,
  items: LaunchItem[],
  ctx: Awaited<ReturnType<typeof loadTemplateContext>>,
  now: Date,
): Promise<void> {
  const faqRows = await db.select().from(faqs).where(eq(faqs.published, true));
  if (faqRows.length === 0) {
    items.push({
      id: "content:faq-empty",
      category: "content",
      severity: "warning",
      title: "No published FAQ",
      detail: "The Help page has no questions.",
      href: "/admin/faq",
    });
  } else {
    const hidden = faqRows.filter((f) => renderTemplate(f.answerMd, ctx).problems.length > 0);
    if (hidden.length > 0) {
      items.push({
        id: "content:faq-hidden",
        category: "content",
        severity: "warning",
        title: `${hidden.length} FAQ ${hidden.length === 1 ? "answer is" : "answers are"} hidden by unresolved settings`,
        detail: "Answers with placeholder or missing tokens are left out of the Help page.",
        href: "/admin/faq",
      });
    }
  }
  const [tiles, vibeRows] = await Promise.all([
    getHeroTilesForAllVibes(db, 50, { now }),
    db.select({ slug: vibes.slug, name: vibes.name }).from(vibes).orderBy(asc(vibes.sort)),
  ]);
  for (const v of vibeRows) {
    const count = (tiles[v.slug] ?? []).length;
    if (count < HERO_TILES_MIN) {
      items.push({
        id: `content:hero:${v.slug}`,
        category: "content",
        severity: "warning",
        title: `${v.name} hero has ${count} of ${HERO_TILES_MIN} product cutouts`,
        detail: "Add products with transparent cutouts so the hero collage is full.",
        href: "/admin/content?tab=hero",
      });
    }
  }
}
