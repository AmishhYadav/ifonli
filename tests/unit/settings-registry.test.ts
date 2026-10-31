import { describe, expect, it } from "vitest";

import zones from "../../data/reference/zones.json";
import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  SHIPPING_ZONES,
  isRequiredForLaunch,
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

  it("settings nothing reads are locked and marked unused; hero_enabled stays editable", () => {
    for (const key of ["guest_checkout_enabled", "login_methods", "custom_cursor_enabled"] as const) {
      expect(SETTINGS[key]).toMatchObject({ locked: true, unused: true });
      expect(SETTINGS[key].description).toMatch(/^Not used in this version/);
    }
    expect(SETTINGS.hero_enabled).not.toHaveProperty("locked");
    expect(SETTINGS.hero_enabled).not.toHaveProperty("unused");
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

  describe("policy copy keys (content/README.md)", () => {
    const POLICY_KEYS = [
      "policy.jurisdiction_city",
      "policy.processors",
      "policy.hippers_definition",
      "policy.materials_note",
      "policy.handmade_note",
      "policy.working_days",
      "policy.courier_partners",
      "policy.delivery_attempts",
      "policy.rto_handling",
      "policy.refund_initiation_days",
      "policy.refund_bank_days",
      "policy.cod_refund_days",
      "policy.replacement_days",
      "policy.return_conditions",
      "policy.non_returnable_items",
      "policy.return_shipping_rule",
      "policy.shipping_fee_refund_rule",
      "policy.retention_order_records",
      "policy.retention_period",
    ] as const;

    it("registers every NEW key in the policies group", () => {
      for (const key of POLICY_KEYS) {
        expect(SETTINGS[key].group, key).toBe("policies");
        expect(SETTING_KEYS).toContain(key);
      }
      expect(settingsInGroup("policies").sort()).toEqual([...POLICY_KEYS].sort());
    });

    it("has fake-looking placeholders for owner text and valid typed numbers", () => {
      for (const key of POLICY_KEYS) {
        const def = SETTINGS[key];
        if (typeof def.placeholder === "string" && key !== "policy.handmade_note") {
          expect(def.placeholder, key).toMatch(/^PLACEHOLDER/);
        }
      }
      expect(SETTINGS["policy.delivery_attempts"].schema.safeParse(0).success).toBe(false);
      expect(SETTINGS["policy.refund_initiation_days"].schema.safeParse(2.5).success).toBe(false);
      expect(SETTINGS["policy.cod_refund_days"].schema.safeParse(3).success).toBe(true);
      expect(SETTINGS["policy.jurisdiction_city"].schema.safeParse("  ").success).toBe(false);
    });

    it("marks Markdown strings, and only handmade_note is optional for launch", () => {
      for (const key of [
        "policy.processors",
        "policy.hippers_definition",
        "policy.materials_note",
        "policy.rto_handling",
        "policy.return_conditions",
        "policy.non_returnable_items",
        "policy.return_shipping_rule",
        "policy.shipping_fee_refund_rule",
      ] as const) {
        expect(SETTINGS[key].format, key).toBe("md");
      }
      for (const key of POLICY_KEYS) {
        expect(SETTINGS[key].requiredForLaunch, key).toBe(key !== "policy.handmade_note");
      }
    });

    it("return-policy copy is required only when returns are enabled", () => {
      const def = SETTINGS["policy.return_conditions"];
      expect(def.requiredUnless).toEqual({ key: "return_policy_type", equals: "no_returns" });
      expect(isRequiredForLaunch(def, () => "no_returns")).toBe(false);
      expect(isRequiredForLaunch(def, () => "returns_window")).toBe(true);
      expect(isRequiredForLaunch(SETTINGS["policy.working_days"], () => "no_returns")).toBe(true);
      expect(isRequiredForLaunch(SETTINGS.brand_name, () => undefined)).toBe(false);
    });

    it("tags money and status-list keys for the template renderer", () => {
      for (const key of ["flat_fee", "free_threshold", "cod_fee", "cod_max_order_value"] as const) {
        expect(SETTINGS[key].format).toBe("money");
      }
      expect(SETTINGS.cancellable_statuses.format).toBe("fulfillment_statuses");
    });

    it("delivery_estimates_by_zone accepts exactly the zones from zones.json", () => {
      expect([...SHIPPING_ZONES]).toEqual(zones.zones);
      const schema = SETTINGS.delivery_estimates_by_zone.schema;
      for (const zone of zones.zones) {
        expect(schema.safeParse({ [zone]: { minDays: 2, maxDays: 5 } }).success, zone).toBe(true);
      }
      expect(schema.safeParse({ mars: { minDays: 2, maxDays: 5 } }).success).toBe(false);
    });
  });
});
