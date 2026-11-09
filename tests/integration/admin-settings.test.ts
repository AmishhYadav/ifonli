import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { adminAuditLog, settings, states, user } from "@/server/db/schema";
import {
  SettingAdminValidationError,
  listSettingsAdmin,
  placeholderTextPaths,
  updateSettingAdmin,
} from "@/server/services/admin/settings";
import { AdminInputError } from "@/server/services/admin/products";
import {
  SETTING_KEYS,
  getSetting,
  getSettingEntry,
  seedMissingSettings,
} from "@/server/services/settings";

const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };

async function setup() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
    ]);
  await seedMissingSettings();
}

const save = (key: string, value: unknown, who = owner) =>
  updateSettingAdmin(getDb(), key, value, who);
async function issuesOf(key: string, value: unknown): Promise<{ path: string; message: string }[]> {
  const err = await save(key, value).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SettingAdminValidationError);
  return (err as SettingAdminValidationError).issues;
}

describe("admin settings: listing", () => {
  it("lists every registry key with placeholder / launch / lock flags", async () => {
    await setup();
    const rows = await listSettingsAdmin(getDb());
    expect(rows.map((r) => r.key)).toEqual(SETTING_KEYS);
    const legal = rows.find((r) => r.key === "legal_name")!;
    expect(legal).toMatchObject({
      isPlaceholder: true,
      blocksLaunch: true,
      locked: false,
      group: "store",
    });
    expect(rows.find((r) => r.key === "prices_include_gst")).toMatchObject({
      locked: true,
      isPlaceholder: false,
    });
    expect(rows.find((r) => r.key === "brand_name")).toMatchObject({
      isPlaceholder: true,
      blocksLaunch: false,
    });
    // Return-policy copy only blocks launch once returns exist.
    expect(rows.find((r) => r.key === "policy.return_conditions")?.blocksLaunch).toBe(false);
    await save("return_policy_type", "returns_window");
    expect(
      (await listSettingsAdmin(getDb())).find((r) => r.key === "policy.return_conditions")
        ?.blocksLaunch,
    ).toBe(true);
  });

  it("works on an empty settings table (every key falls back to its placeholder)", async () => {
    await getDb()
      .insert(user)
      .values({ id: "owner-1", name: "O", email: "o@example.com", role: "owner" });
    const rows = await listSettingsAdmin(getDb());
    expect(rows).toHaveLength(SETTING_KEYS.length);
    expect(
      rows.every((r) => r.isPlaceholder || r.locked || r.key === "guest_checkout_enabled"),
    ).toBe(true);
  });

  it("a stored value that no longer satisfies the schema shows as unset", async () => {
    await setup();
    await getDb()
      .update(settings)
      .set({ value: "not-an-email", isPlaceholder: false })
      .where(eq(settings.key, "support_email"));
    const row = (await listSettingsAdmin(getDb())).find((r) => r.key === "support_email")!;
    expect(row.isPlaceholder).toBe(true);
    expect(row.value).toBe("placeholder@example.invalid");
  });
});

describe("admin settings: saving each kind of value", () => {
  it("text: stores trimmed text, clears the placeholder flag, records who and the audit diff", async () => {
    await setup();
    const out = await save("legal_name", "  IfOnli Crafts Pvt Ltd  ");
    expect(out).toMatchObject({ key: "legal_name", value: "IfOnli Crafts Pvt Ltd", changed: true });
    const entry = await getSettingEntry("legal_name");
    expect(entry).toMatchObject({ value: "IfOnli Crafts Pvt Ltd", isPlaceholder: false });
    const [row] = await getDb().select().from(settings).where(eq(settings.key, "legal_name"));
    expect(row?.updatedBy).toBe(owner.id);
    const [audit] = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "setting.update"));
    expect(audit).toMatchObject({ actorId: owner.id, entity: "setting", entityId: "legal_name" });
    expect(audit?.diff).toEqual({
      before: { value: "PLACEHOLDER — Legal entity name", isPlaceholder: true },
      after: { value: "IfOnli Crafts Pvt Ltd", isPlaceholder: false },
    });
    expect((await issuesOf("legal_name", "   "))[0]?.message).toBeTruthy();
  });

  it("confirming an unchanged value still clears the placeholder flag (changed = false)", async () => {
    await setup();
    expect((await getSettingEntry("brand_name")).isPlaceholder).toBe(true);
    expect(await save("brand_name", "IfOnli")).toMatchObject({ changed: false });
    expect((await getSettingEntry("brand_name")).isPlaceholder).toBe(false);
  });

  it("email and nullable text (GSTIN, GA4 id)", async () => {
    await setup();
    expect((await issuesOf("support_email", "not-an-email"))[0]?.message).toMatch(/email/i);
    await save("support_email", "care@ifonli.in");
    expect(await getSetting("support_email")).toBe("care@ifonli.in");

    expect((await issuesOf("gstin", "123"))[0]?.message).toMatch(/GSTIN/);
    await save("gstin", "27aabcu9603r1zm");
    expect(await getSetting("gstin")).toBe("27AABCU9603R1ZM");
    await save("gstin", null);
    expect(await getSetting("gstin")).toBeNull();
    const [raw] = await getDb().select().from(settings).where(eq(settings.key, "gstin"));
    expect(raw?.value).toBeNull(); // JSON null, not SQL NULL (the column is NOT NULL)

    await issuesOf("ga4_measurement_id", "UA-1");
    await save("ga4_measurement_id", "G-ABC123");
    expect(await getSetting("ga4_measurement_id")).toBe("G-ABC123");
  });

  it("integers: ranges and whole numbers (days, basis points, quantities)", async () => {
    await setup();
    await issuesOf("processing_days", 2.5);
    await issuesOf("processing_days", -1);
    await issuesOf("processing_days", 61);
    await issuesOf("processing_days", "3");
    await save("processing_days", 3);
    expect(await getSetting("processing_days")).toBe(3);
    await issuesOf("default_gst_rate_bp", 10001);
    await save("default_gst_rate_bp", 1800);
    await issuesOf("max_qty_per_line", 0);
    await issuesOf("reservation_ttl_minutes", 1441);
  });

  it("money in paise: whole, non-negative", async () => {
    await setup();
    await issuesOf("flat_fee", 49.5);
    await issuesOf("flat_fee", -1);
    await save("flat_fee", 4900);
    await save("free_threshold", 99900);
    await save("cod_fee", 0); // zero is a legitimate answer and clears the flag
    expect((await getSettingEntry("cod_fee")).isPlaceholder).toBe(false);
    expect(await getSetting("flat_fee")).toBe(4900);
  });

  it("booleans and enums", async () => {
    await setup();
    await issuesOf("cod_enabled", "yes");
    await save("cod_enabled", true);
    expect(await getSetting("cod_enabled")).toBe(true);
    await issuesOf("return_policy_type", "sometimes");
    await save("return_policy_type", "returns_window");
    await save("hero_enabled", false);
    expect(await getSetting("hero_enabled")).toBe(false);
  });

  it("arrays: enum lists, string lists, email lists, pincodes", async () => {
    await setup();
    await issuesOf("cancellable_statuses", ["unfulfilled", "teleported"]);
    await save("cancellable_statuses", ["unfulfilled", "packed"]);
    expect(await getSetting("cancellable_statuses")).toEqual(["unfulfilled", "packed"]);
    await save("cancellable_statuses", []);
    await issuesOf("admin_alert_emails", []);
    await issuesOf("admin_alert_emails", ["ok@ifonli.in", "nope"]);
    expect(
      (await issuesOf("admin_alert_emails", ["a@ifonli.in", "A@ifonli.in"]))[0]?.message,
    ).toMatch(/twice/);
    await save("admin_alert_emails", ["ops@ifonli.in", "owner@ifonli.in"]);
    await issuesOf("cod_excluded_pincodes", ["12345"]);
    expect((await issuesOf("cod_excluded_pincodes", ["560001", "560001"]))[0]?.message).toMatch(
      /twice/,
    );
    await save("cod_excluded_pincodes", ["560001", "110001"]);
  });

  it("nested objects report the failing field path", async () => {
    await setup();
    const issues = await issuesOf("default_manufacturer", { name: "Maker", address: "" });
    expect(issues.map((i) => i.path)).toEqual(["address"]);
    await save("default_manufacturer", { name: "Maker Co", address: "12 Example Road, Pune" });
    expect(await getSetting("default_manufacturer")).toMatchObject({ name: "Maker Co" });
    await issuesOf("default_manufacturer", { name: "Maker" });
    await save("notification_channels", {
      ...(await getSetting("notification_channels")),
      shipped: { email: true, whatsapp: true },
    });
    await issuesOf("notification_channels", { shipped: { email: true } });
  });

  it("zone maps: only known zones, ranges ordered, partial maps allowed", async () => {
    await setup();
    await issuesOf("zone_overrides", { mars: 100 });
    await issuesOf("zone_overrides", { north_east: -5 });
    await save("zone_overrides", { north_east: 9900 });
    expect(await getSetting("zone_overrides")).toEqual({ north_east: 9900 });
    await save("zone_overrides", {});

    const bad = await issuesOf("delivery_estimates_by_zone", {
      metro_region: { minDays: 5, maxDays: 2 },
    });
    expect(bad[0]?.message).toMatch(/maxDays/);
    await save("delivery_estimates_by_zone", {
      metro_region: { minDays: 2, maxDays: 4 },
      rest_of_india: { minDays: 4, maxDays: 7 },
    });
    expect(await getSetting("delivery_estimates_by_zone")).toMatchObject({
      metro_region: { minDays: 2, maxDays: 4 },
    });
  });

  it("vibes: known slugs only, no duplicates, default may be 'random'", async () => {
    await setup();
    expect((await issuesOf("vibe_cycle", ["cute", "mystery"]))[0]?.message).toMatch(/Unknown vibe/);
    expect((await issuesOf("vibe_cycle", ["cute", "cute"]))[0]?.message).toMatch(/twice/);
    await issuesOf("vibe_cycle", []);
    await save("vibe_cycle", ["gothic", "cute", "bold"]);
    expect(await getSetting("vibe_cycle")).toEqual(["gothic", "cute", "bold"]);
    await issuesOf("default_vibe", "mystery");
    await save("default_vibe", "random");
    await save("default_vibe", "gothic");
  });

  it("state must be a known state once reference data is loaded", async () => {
    await setup();
    await save("state", "Anything goes while the reference table is empty");
    await getDb()
      .insert(states)
      .values({
        code: "27",
        name: "Maharashtra",
        iso: "IN-MH",
        type: "state",
        zone: "rest_of_india",
      });
    expect((await issuesOf("state", "Atlantis"))[0]?.message).toMatch(/Not a known/);
    await save("state", "maharashtra");
    expect(await getSetting("state")).toBe("maharashtra");
  });

  it("long Markdown policy copy is stored as written", async () => {
    await setup();
    const md = "- Razorpay (payments)\n- Delhivery (courier)\n- Resend (email)";
    await save("policy.processors", md);
    expect(await getSetting("policy.processors")).toBe(md);
  });
});

describe("admin settings: guard rails", () => {
  it("refuses placeholder text, keeping the flag set", async () => {
    await setup();
    expect((await issuesOf("legal_name", "PLACEHOLDER — Legal entity name"))[0]?.message).toMatch(
      /placeholder/i,
    );
    expect((await issuesOf("support_email", "placeholder@example.invalid"))[0]?.message).toMatch(
      /placeholder/i,
    );
    const issues = await issuesOf("default_manufacturer", {
      name: "PLACEHOLDER — Manufacturer name",
      address: "12 Example Road, Pune",
    });
    expect(issues.map((i) => i.path)).toEqual(["name"]);
    expect((await getSettingEntry("legal_name")).isPlaceholder).toBe(true);
    expect(placeholderTextPaths({ a: ["x", " PLACEHOLDER y"], b: "fine" })).toEqual(["a.1"]);
    expect(placeholderTextPaths("placeholderish")).toEqual([]);
  });

  it("locked and unknown keys cannot be saved", async () => {
    await setup();
    await expect(save("prices_include_gst", true)).rejects.toThrow(/locked/);
    await expect(save("backorders", false)).rejects.toThrow(/locked/);
    // Settings nothing reads in this version cannot be edited either (the admin says "Not used").
    await expect(save("custom_cursor_enabled", true)).rejects.toThrow(/locked/);
    await expect(save("login_methods", ["email_otp"])).rejects.toThrow(/locked/);
    await expect(save("guest_checkout_enabled", false)).rejects.toThrow(/locked/);
    // All three serviceability modes behaved the same, so the mode is no longer a choice.
    await expect(save("serviceability_mode", "allowlist")).rejects.toThrow(/locked/);
    await expect(save("nope", 1)).rejects.toBeInstanceOf(AdminInputError);
    await expect(save("__proto__", 1)).rejects.toBeInstanceOf(AdminInputError);
  });

  it("is owner-only (setting:update)", async () => {
    await setup();
    await expect(save("brand_name", "X", admin)).rejects.toThrow(/Forbidden/);
    await expect(save("brand_name", "X", { id: "f", role: "fulfilment" })).rejects.toThrow(
      /Forbidden/,
    );
    expect((await getSettingEntry("brand_name")).isPlaceholder).toBe(true);
    expect(await getDb().select().from(adminAuditLog)).toHaveLength(0);
  });

  it("a failed save writes nothing", async () => {
    await setup();
    await issuesOf("processing_days", 999);
    expect(await getDb().select().from(adminAuditLog)).toHaveLength(0);
    expect((await getSettingEntry("processing_days")).isPlaceholder).toBe(true);
  });
});
