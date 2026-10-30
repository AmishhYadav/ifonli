import { describe, expect, it } from "vitest";

import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  settingsInGroup,
} from "@/server/services/settings-registry";

describe("settings registry", () => {
  it("every placeholder satisfies its own schema", () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key];
      const parsed = def.schema.safeParse(def.placeholder);
      expect(parsed.success, `${key}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("every key belongs to a known group and has label and description", () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key];
      expect(def.key).toBe(key);
      expect(SETTING_GROUPS).toContain(def.group);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
    expect(SETTING_GROUPS.every((g) => settingsInGroup(g).length > 0)).toBe(true);
  });

  it("free-text owner placeholders are obviously fake", () => {
    for (const key of [
      "legal_name",
      "registered_address",
      "support_phone",
      "default_country_of_origin",
    ] as const) {
      expect(SETTINGS[key].placeholder).toMatch(/^PLACEHOLDER/);
    }
    expect(SETTINGS.support_email.placeholder).toMatch(/\.invalid$/);
  });

  it("fees and thresholds default to 0 and are launch-gated", () => {
    for (const key of ["flat_fee", "free_threshold", "cod_fee", "cod_max_order_value"] as const) {
      expect(SETTINGS[key].placeholder).toBe(0);
      expect(SETTINGS[key].requiredForLaunch).toBe(true);
    }
  });

  it("locks and fixed decisions match the plan", () => {
    expect(SETTINGS.prices_include_gst).toMatchObject({ placeholder: true, locked: true });
    expect(SETTINGS.backorders).toMatchObject({ placeholder: false, locked: true });
    expect(SETTINGS.guest_checkout_enabled.placeholder).toBe(true);
    expect(SETTINGS.vibe_cycle.placeholder).toEqual([
      "cute",
      "bold",
      "overthinking",
      "gothic",
      "funky",
    ]);
    expect(SETTINGS.default_vibe.placeholder).toBe("cute");
    expect(SETTINGS.prices_include_gst.schema.safeParse(false).success).toBe(false);
    expect(SETTINGS.backorders.schema.safeParse(true).success).toBe(false);
  });

  it("schemas reject bad input", () => {
    expect(SETTINGS.support_email.schema.safeParse("nope").success).toBe(false);
    expect(SETTINGS.gstin.schema.safeParse("123").success).toBe(false);
    expect(SETTINGS.gstin.schema.safeParse("27AAAPL1234C1ZV").success).toBe(true);
    expect(SETTINGS.flat_fee.schema.safeParse(1.5).success).toBe(false);
    expect(
      SETTINGS.delivery_estimates_by_zone.schema.safeParse({
        north_east: { minDays: 5, maxDays: 2 },
      }).success,
    ).toBe(false);
    expect(SETTINGS.cod_excluded_pincodes.schema.safeParse(["12345"]).success).toBe(false);
  });
});
