import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { POLICY_SLUGS } from "@/server/content/policies";
import { getDb } from "@/server/db";
import { faqs, policies, productImages, settings, user, variants } from "@/server/db/schema";
import {
  checkEnvironment,
  getLaunchReadiness,
  type LaunchReadiness,
} from "@/server/services/admin/launch";
import { publishPolicy, savePolicyDraft } from "@/server/services/admin/policies";
import { updateSettingAdmin } from "@/server/services/admin/settings";
import { SETTINGS, SETTING_KEYS, isRequiredForLaunch, seedMissingSettings } from "@/server/services/settings";

import { seedCatalogFixture } from "./catalog-fixture";

const owner = { id: "owner-1", role: "owner" };

const LIVE_ENV = {
  NODE_ENV: "production",
  RAZORPAY_KEY_ID: "rzp_live_abc123",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
  RESEND_API_KEY: "re_123",
  EMAIL_FROM: "IfOnli <orders@ifonli.in>",
  BETTER_AUTH_SECRET: "x".repeat(40),
  ORDER_TOKEN_SECRET: "o".repeat(40),
  CRON_SECRET: "c".repeat(40),
  NEXT_PUBLIC_SITE_URL: "https://ifonli.in",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SENTRY_DSN: "https://sentry.example/1",
};

const ids = (r: LaunchReadiness, category?: string) =>
  r.items.filter((i) => !category || i.category === category).map((i) => i.id);

async function owner1() {
  await getDb().insert(user).values({ id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" });
}

/** Fill every launch-required setting with a real-looking value (through the same validation as the UI). */
async function fillAllSettings() {
  const real: Record<string, unknown> = {
    legal_name: "IfOnli Crafts Pvt Ltd",
    registered_address: "12 Example Road, Pune 411001",
    state: "Maharashtra",
    support_email: "care@ifonli.in",
    support_phone: "+91 98765 43210",
    support_hours: "Mon-Sat 10:00-18:00 IST",
    response_time: "within 24 hours",
    grievance_officer: { name: "Asha Rao", designation: "Grievance Officer", email: "go@ifonli.in", phone: "+91 98765 43210" },
    default_manufacturer: { name: "IfOnli Crafts", address: "12 Example Road, Pune" },
    default_country_of_origin: "India",
    default_gst_rate_bp: 300,
    shipping_tax_rule: "dominant_line_rate",
    serviceability_mode: "all_india",
    flat_fee: 4900,
    free_threshold: 99900,
    processing_days: 2,
    delivery_estimates_by_zone: { metro_region: { minDays: 2, maxDays: 4 } },
    cod_enabled: false,
    cod_fee: 0,
    cod_max_order_value: 0,
    reservation_ttl_minutes: 15,
    default_low_stock_threshold: 5,
    max_qty_per_line: 10,
    cancellable_statuses: ["unfulfilled"],
    return_policy_type: "no_returns",
    returns_window_days: 0,
    damaged_claim_window_hours: 48,
    vibe_cycle: ["cute", "bold", "overthinking", "gothic", "funky"],
    default_vibe: "cute",
    admin_alert_emails: ["ops@ifonli.in"],
    "policy.jurisdiction_city": "Pune",
    "policy.processors": "- Razorpay\n- Resend",
    "policy.hippers_definition": "Hippers are hip charms.",
    "policy.materials_note": "Resin and alloy.",
    "policy.working_days": "Monday to Saturday",
    "policy.courier_partners": "Delhivery",
    "policy.delivery_attempts": 2,
    "policy.rto_handling": "We reship once.",
    "policy.refund_initiation_days": 3,
    "policy.refund_bank_days": "5 to 7 working days",
    "policy.cod_refund_days": 5,
    "policy.replacement_days": "7 working days",
    "policy.shipping_fee_refund_rule": "Shipping is refunded on full cancellation.",
    "policy.retention_order_records": "8 years",
    "policy.retention_period": "2 years",
  };
  for (const [key, value] of Object.entries(real)) await updateSettingAdmin(getDb(), key, value, owner);
}

describe("getLaunchReadiness", () => {
  it("a fresh install is not ready: lists settings, policies, products and env", async () => {
    await owner1();
    await seedMissingSettings();
    const r = await getLaunchReadiness(getDb(), { env: {} });
    expect(r.ready).toBe(false);
    expect(r.blockers).toBeGreaterThan(20);
    expect(r.categories.map((c) => c.id)).toEqual(["settings", "products", "policies", "environment", "content"]);

    // Every required, still-placeholder setting is listed with a link to its form.
    const required = SETTING_KEYS.filter((k) => isRequiredForLaunch(SETTINGS[k], () => "no_returns"));
    expect(ids(r, "settings").sort()).toEqual(required.map((k) => `setting:${k}`).sort());
    const legal = r.items.find((i) => i.id === "setting:legal_name")!;
    expect(legal).toMatchObject({ severity: "blocker", href: "/admin/settings?group=store#setting-legal_name" });
    // Optional keys and the conditional return-policy copy are not listed.
    expect(ids(r)).not.toContain("setting:brand_name");
    expect(ids(r)).not.toContain("setting:policy.return_conditions");

    expect(ids(r, "products")).toEqual(["products:none"]);
    expect(ids(r, "policies")).toEqual(POLICY_SLUGS.map((s) => `policy:${s}`));
    expect(ids(r, "environment")).toEqual(expect.arrayContaining(["env:razorpay", "env:resend", "env:site-url"]));
  });

  it("settings drop off the list as they are saved; return copy joins when returns are enabled", async () => {
    await owner1();
    await seedMissingSettings();
    const before = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    await updateSettingAdmin(getDb(), "legal_name", "IfOnli Crafts Pvt Ltd", owner);
    const after = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(ids(after, "settings")).not.toContain("setting:legal_name");
    expect(after.blockers).toBe(before.blockers - 1);

    await updateSettingAdmin(getDb(), "return_policy_type", "returns_window", owner);
    const withReturns = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(ids(withReturns, "settings")).toEqual(
      expect.arrayContaining(["setting:policy.return_conditions", "setting:policy.non_returnable_items"]),
    );
  });

  it("flags active products with placeholder images or PH- SKUs; archived/draft ones do not count", async () => {
    await owner1();
    await seedMissingSettings();
    const f = await seedCatalogFixture();
    await getDb()
      .update(productImages)
      .set({ isPlaceholder: true })
      .where(eq(productImages.productId, f.products["skull-charm"]!));
    await getDb().update(variants).set({ sku: "PH-CAT-1" }).where(eq(variants.id, f.variants.cat!));
    // A draft product's placeholder does not matter.
    await getDb()
      .insert(productImages)
      .values({ productId: f.products["draft-thing"]!, kind: "photo", path: "/p.svg", alt: "p", isPlaceholder: true });

    const r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(ids(r, "products")).toEqual(["products:placeholder-images", "products:placeholder-skus"]);
    const img = r.items.find((i) => i.id === "products:placeholder-images")!;
    expect(img.title).toMatch(/^1 active product uses placeholder images/);
    expect(img.detail).toBe("1 placeholder cutout and 1 placeholder photo. Replace them with real photography.");
    expect(img.links).toEqual([{ label: "Skull Charm", href: `/admin/products/${f.products["skull-charm"]}` }]);
    const sku = r.items.find((i) => i.id === "products:placeholder-skus")!;
    expect(sku.links?.[0]?.label).toBe("Cat Sticker");

    await getDb().update(productImages).set({ isPlaceholder: false });
    await getDb().update(variants).set({ sku: "CT-1" }).where(eq(variants.id, f.variants.cat!));
    expect(ids(await getLaunchReadiness(getDb(), { env: LIVE_ENV }), "products")).toEqual([]);
  });

  it("policies: missing, unpublished, and published-but-unresolved are each a blocker", async () => {
    await owner1();
    await seedMissingSettings();
    await savePolicyDraft(getDb(), "shipping", { title: "Shipping", bodyMd: "Ships from {{settings.registered_address}}." }, owner);
    let r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(r.items.find((i) => i.id === "policy:shipping")).toMatchObject({
      title: "Shipping is not published",
      href: "/admin/policies/shipping",
    });
    expect(r.items.find((i) => i.id === "policy:terms")?.title).toMatch(/does not exist/);

    // Published before the setting became a placeholder again (e.g. restored seed): still flagged.
    await getDb().update(policies).set({ published: true }).where(eq(policies.slug, "shipping"));
    r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(r.items.find((i) => i.id === "policy:shipping")).toMatchObject({
      title: "Shipping has unresolved settings",
    });
    expect(r.items.find((i) => i.id === "policy:shipping")?.detail).toContain("settings.registered_address");

    await updateSettingAdmin(getDb(), "registered_address", "12 Example Road, Pune", owner);
    r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(ids(r, "policies")).not.toContain("policy:shipping");
  });

  it("FAQ answers hidden by tokens and empty FAQ are warnings, never blockers", async () => {
    await owner1();
    await seedMissingSettings();
    let r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(r.items.find((i) => i.id === "content:faq-empty")?.severity).toBe("warning");
    await getDb().insert(faqs).values({ category: "delivery", question: "q", answerMd: "{{settings.support_phone}}", position: 1 });
    r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(r.items.find((i) => i.id === "content:faq-hidden")).toMatchObject({ severity: "warning" });
    expect(ids(r)).not.toContain("content:faq-empty");
  });

  it("hero vibes with fewer than 8 cutout products are warnings", async () => {
    await owner1();
    await seedMissingSettings();
    await seedCatalogFixture();
    const r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    const hero = r.items.filter((i) => i.id.startsWith("content:hero:"));
    expect(hero.map((i) => i.id)).toEqual(["content:hero:cute", "content:hero:bold", "content:hero:gothic"]);
    expect(hero[0]).toMatchObject({ severity: "warning", title: "Cute hero has 1 of 8 product cutouts" });
  });

  it("is ready: yes only when there are no blockers (warnings allowed)", async () => {
    await owner1();
    await seedMissingSettings();
    await seedCatalogFixture();
    await fillAllSettings();
    for (const slug of POLICY_SLUGS) {
      await savePolicyDraft(getDb(), slug, { title: `Policy ${slug}`, bodyMd: `Text for {{settings.brand_name}} (${slug})` }, owner);
    }
    // brand_name is still a placeholder but not required for launch, so tokens resolve.
    for (const slug of POLICY_SLUGS) await publishPolicy(getDb(), slug, { effectiveDate: "2026-10-01" }, owner);

    const r = await getLaunchReadiness(getDb(), { env: LIVE_ENV });
    expect(r.items.filter((i) => i.severity === "blocker")).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.blockers).toBe(0);
    expect(r.warnings).toBeGreaterThan(0); // thin hero sets + empty FAQ
    expect(r.categories.every((c) => c.blockers === 0)).toBe(true);

    // Breaking one thing flips it back.
    const broken = await getLaunchReadiness(getDb(), { env: { ...LIVE_ENV, RAZORPAY_KEY_ID: "rzp_test_abc" } });
    expect(broken.ready).toBe(false);
    expect(ids(broken, "environment")).toEqual(["env:razorpay"]);
    await getDb().update(settings).set({ isPlaceholder: true }).where(eq(settings.key, "legal_name"));
    expect((await getLaunchReadiness(getDb(), { env: LIVE_ENV })).ready).toBe(false);
  });
});

describe("checkEnvironment", () => {
  it("passes a complete production environment (only optional-service warnings can remain)", () => {
    expect(checkEnvironment(LIVE_ENV)).toEqual([]);
    expect(checkEnvironment({ ...LIVE_ENV, SENTRY_DSN: undefined }).map((i) => [i.id, i.severity])).toEqual([
      ["env:sentry", "warning"],
    ]);
  });

  it("blocks on missing or test Razorpay keys and webhook secret", () => {
    const ids = (env: Record<string, string | undefined>) => checkEnvironment(env).map((i) => i.id);
    expect(ids({ ...LIVE_ENV, RAZORPAY_KEY_ID: undefined })).toEqual(["env:razorpay"]);
    expect(ids({ ...LIVE_ENV, RAZORPAY_KEY_SECRET: "  " })).toEqual(["env:razorpay"]);
    expect(ids({ ...LIVE_ENV, RAZORPAY_KEY_ID: "rzp_test_x" })).toEqual(["env:razorpay"]);
    expect(ids({ ...LIVE_ENV, RAZORPAY_WEBHOOK_SECRET: "" })).toEqual(["env:razorpay-webhook"]);
  });

  it("blocks on Resend, secrets, storage and a non-https or local site URL", () => {
    const ids = (over: Record<string, string | undefined>) => checkEnvironment({ ...LIVE_ENV, ...over }).map((i) => i.id);
    expect(ids({ RESEND_API_KEY: undefined })).toEqual(["env:resend"]);
    expect(ids({ EMAIL_FROM: undefined })).toEqual(["env:email-from"]);
    expect(ids({ BETTER_AUTH_SECRET: "short" })).toEqual(["env:auth-secret"]);
    expect(ids({ ORDER_TOKEN_SECRET: undefined })).toEqual(["env:order-token"]);
    expect(ids({ CRON_SECRET: undefined })).toEqual(["env:cron"]);
    expect(ids({ SUPABASE_SERVICE_ROLE_KEY: undefined })).toEqual(["env:storage"]);
    expect(ids({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toEqual(["env:site-url"]);
    expect(ids({ NEXT_PUBLIC_SITE_URL: "http://ifonli.in" })).toEqual(["env:site-url"]);
    expect(ids({ NODE_ENV: "development" })).toEqual(["env:node-env"]);
  });

  it("no item ever echoes a secret value", () => {
    const text = JSON.stringify(checkEnvironment({ ...LIVE_ENV, RAZORPAY_KEY_ID: "rzp_test_SECRETKEYID" }));
    expect(text).not.toContain("SECRETKEYID");
  });
});
