import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { adminAuditLog, settings, user } from "@/server/db/schema";
import {
  SETTING_KEYS,
  SETTINGS,
  SettingLockedError,
  SettingValidationError,
  getLaunchBlockers,
  getSetting,
  getSettingEntry,
  getSettings,
  seedMissingSettings,
  setSetting,
} from "@/server/services/settings";

async function makeActor() {
  const [u] = await getDb()
    .insert(user)
    .values({ id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" })
    .returning();
  return u!.id;
}

describe("settings service", () => {
  it("seeds every registry key as a placeholder, idempotently", async () => {
    expect(await seedMissingSettings()).toBe(SETTING_KEYS.length);
    expect(await seedMissingSettings()).toBe(0);
    const legal = await getSettingEntry("legal_name");
    expect(legal.isPlaceholder).toBe(true);
    expect(legal.value).toMatch(/^PLACEHOLDER/);
    // Owner-confirmed / locked keys are not placeholders.
    expect((await getSettingEntry("prices_include_gst")).isPlaceholder).toBe(false);
    expect((await getSettingEntry("guest_checkout_enabled")).isPlaceholder).toBe(false);
    expect(await getSetting("guest_checkout_enabled")).toBe(true);
    expect(await getSetting("vibe_cycle")).toEqual([
      "cute",
      "bold",
      "overthinking",
      "gothic",
      "funky",
    ]);
    expect(await getSetting("gstin")).toBeNull();
  });

  it("returns the placeholder for keys that were never written", async () => {
    const entry = await getSettingEntry("flat_fee");
    expect(entry.value).toBe(0);
    expect(entry.isPlaceholder).toBe(true);
  });

  it("setSetting validates input", async () => {
    const actor = await makeActor();
    await expect(setSetting("support_email", "not-an-email", actor)).rejects.toBeInstanceOf(
      SettingValidationError,
    );
    await expect(setSetting("flat_fee", -5, actor)).rejects.toBeInstanceOf(SettingValidationError);
    // Nothing was written.
    const rows = await getDb().select().from(settings).where(eq(settings.key, "flat_fee"));
    expect(rows).toHaveLength(0);
  });

  it("setSetting rejects locked keys", async () => {
    await expect(setSetting("backorders", false, null)).rejects.toBeInstanceOf(SettingLockedError);
  });

  it("setSetting stores the value, clears the placeholder flag and writes an audit row", async () => {
    await seedMissingSettings();
    const actor = await makeActor();
    await setSetting("flat_fee", 4900, actor);
    const entry = await getSettingEntry("flat_fee");
    expect(entry).toMatchObject({ value: 4900, isPlaceholder: false });
    const [row] = await getDb().select().from(settings).where(eq(settings.key, "flat_fee"));
    expect(row?.updatedBy).toBe(actor);

    const audit = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.entityId, "flat_fee"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "setting.update", entity: "setting", actorId: actor });
    expect(audit[0]?.diff).toMatchObject({
      before: { value: 0, isPlaceholder: true },
      after: { value: 4900 },
    });
  });

  it("can store JSON null (gstin) and trims/normalises via the schema", async () => {
    await setSetting("gstin", "27aaapl1234c1zv", null);
    expect(await getSetting("gstin")).toBe("27AAAPL1234C1ZV");
    await setSetting("gstin", null, null);
    expect(await getSetting("gstin")).toBeNull();
  });

  it("getSettings(group) lists the group's settings in registry order", async () => {
    await seedMissingSettings();
    const cod = await getSettings("cod");
    expect(cod.map((e) => e.key)).toEqual([
      "cod_enabled",
      "cod_fee",
      "cod_max_order_value",
      "cod_excluded_pincodes",
    ]);
    expect(cod.every((e) => e.isPlaceholder)).toBe(true);
  });

  it("getLaunchBlockers lists required placeholders and shrinks as they are set", async () => {
    await seedMissingSettings();
    const before = await getLaunchBlockers();
    // Return-policy copy only blocks launch once returns are enabled (`requiredUnless`).
    const required = SETTING_KEYS.filter(
      (k) => SETTINGS[k].requiredForLaunch && !("requiredUnless" in SETTINGS[k]),
    );
    expect(before.map((b) => b.key).sort()).toEqual([...required].sort());
    expect(before.map((b) => b.key)).toContain("legal_name");
    expect(before.map((b) => b.key)).not.toContain("brand_name");
    expect(before.map((b) => b.key)).not.toContain("guest_checkout_enabled");

    await setSetting("legal_name", "IfOnli Pvt Ltd", null);
    const after = await getLaunchBlockers();
    expect(after).toHaveLength(before.length - 1);
    expect(after.map((b) => b.key)).not.toContain("legal_name");
  });

  it("getLaunchBlockers works on an empty settings table (nothing seeded yet)", async () => {
    const blockers = await getLaunchBlockers();
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("seeds the policy.* keys and gates return copy on the return policy type", async () => {
    await seedMissingSettings();
    const city = await getSettingEntry("policy.jurisdiction_city");
    expect(city.isPlaceholder).toBe(true);
    expect(city.value).toMatch(/^PLACEHOLDER/);
    expect(await getSetting("policy.handmade_note")).toBe("");
    expect(await getSetting("policy.delivery_attempts")).toBe(1);

    const keys = async () => (await getLaunchBlockers()).map((b) => b.key as string);
    expect(await keys()).toContain("policy.working_days");
    expect(await keys()).not.toContain("policy.return_conditions");
    expect(await keys()).not.toContain("policy.handmade_note");

    await setSetting("return_policy_type", "returns_window", null);
    expect(await keys()).toContain("policy.return_conditions");
    expect(await keys()).toContain("policy.return_shipping_rule");
    await setSetting("policy.return_conditions", "Unused and in original packaging.", null);
    expect(await keys()).not.toContain("policy.return_conditions");
  });
});
