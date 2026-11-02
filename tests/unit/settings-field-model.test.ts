import { describe, expect, it } from "vitest";

import {
  fromDraft,
  humanize,
  isBlank,
  nodeForSetting,
  paiseToRupees,
  rupeesToPaise,
  toDraft,
  type Draft,
  type Node,
} from "@/components/admin/settings/field-model";
import { SETTINGS, SETTING_KEYS } from "@/server/services/settings-registry";

describe("settings form model", () => {
  it("builds a typed control tree for every registry key", () => {
    for (const key of SETTING_KEYS) {
      const node = nodeForSetting(key);
      expect(node.kind, key).toBeDefined();
      // The generic fallback is a text box; no registry key should need it.
      if (node.kind === "text") expect(typeof node.multiline).toBe("boolean");
    }
  });

  it("every placeholder survives draft -> value unchanged and still satisfies its schema", () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key];
      const node = nodeForSetting(key);
      const placeholder = def.schema.parse(def.placeholder);
      const { value, errors } = fromDraft(node, toDraft(node, placeholder));
      expect(errors, key).toEqual({});
      expect(value, key).toEqual(placeholder);
      expect(def.schema.safeParse(value).success, key).toBe(true);
    }
  });

  it("maps value kinds to the right controls", () => {
    const kind = (key: Parameters<typeof nodeForSetting>[0]) => nodeForSetting(key).kind;
    expect(kind("legal_name")).toBe("text");
    expect(kind("support_email")).toBe("text");
    expect((nodeForSetting("support_email") as Extract<Node, { kind: "text" }>).email).toBe(true);
    expect(kind("gstin")).toBe("nullable");
    expect(kind("processing_days")).toBe("number");
    expect(kind("cod_enabled")).toBe("boolean");
    expect(kind("return_policy_type")).toBe("enum");
    expect(kind("shipping_tax_rule")).toBe("enum");
    expect(kind("cancellable_statuses")).toBe("choices");
    expect(kind("admin_alert_emails")).toBe("lines");
    expect(kind("cod_excluded_pincodes")).toBe("lines");
    expect(kind("grievance_officer")).toBe("object");
    expect(kind("notification_channels")).toBe("object");
    expect(kind("zone_overrides")).toBe("record");
    expect(kind("delivery_estimates_by_zone")).toBe("record");
    expect(kind("prices_include_gst")).toBe("boolean");
  });

  it("money keys are rupees in the form and paise in the value", () => {
    for (const key of ["flat_fee", "free_threshold", "cod_fee", "cod_max_order_value"] as const) {
      const node = nodeForSetting(key) as Extract<Node, { kind: "number" }>;
      expect(node.money).toBe(true);
    }
    const flat = nodeForSetting("flat_fee");
    expect(toDraft(flat, 4950)).toBe("49.50");
    expect(toDraft(flat, 4900)).toBe("49");
    expect(fromDraft(flat, "49.50").value).toBe(4950);
    expect(fromDraft(flat, "₹1,299").value).toBe(129900);
    expect(fromDraft(flat, "0").value).toBe(0);
    expect(fromDraft(flat, "49.505").errors[""]).toMatch(/rupees/);
    expect(fromDraft(flat, "-5").errors[""]).toMatch(/rupees/);
    expect(fromDraft(flat, "abc").errors[""]).toMatch(/rupees/);
    expect(fromDraft(flat, "").errors[""]).toBe("Enter a number");
    // Other numbers are not money.
    const days = nodeForSetting("processing_days") as Extract<Node, { kind: "number" }>;
    expect(days).toMatchObject({ money: false, integer: true, min: 0, max: 60 });
    expect(fromDraft(days, "2.5").errors[""]).toBe("Enter a whole number");
    expect(fromDraft(days, "3").value).toBe(3);
    // Zone overrides hold money too, via the hint.
    const zones = nodeForSetting("zone_overrides") as Extract<Node, { kind: "record" }>;
    expect(zones.value).toMatchObject({ kind: "number", money: true });
  });

  it("rupee helpers are exact (no floating point drift)", () => {
    expect(rupeesToPaise("0.29")).toBe(29);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise("1.1")).toBe(110);
    expect(rupeesToPaise(" 5 ")).toBe(500);
    expect(rupeesToPaise("1e3")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(paiseToRupees(1999)).toBe("19.99");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(paiseToRupees(0)).toBe("0");
  });

  it("nullable text: blank means null", () => {
    const gstin = nodeForSetting("gstin");
    expect(toDraft(gstin, null)).toBe("");
    expect(fromDraft(gstin, "").value).toBeNull();
    expect(fromDraft(gstin, "27AABCU9603R1ZM").value).toBe("27AABCU9603R1ZM");
  });

  it("lines: one per line, commas and blanks tolerated", () => {
    const emails = nodeForSetting("admin_alert_emails");
    expect(toDraft(emails, ["a@x.in", "b@x.in"])).toBe("a@x.in\nb@x.in");
    expect(fromDraft(emails, "a@x.in,\n b@x.in \n\n").value).toEqual(["a@x.in", "b@x.in"]);
  });

  it("nested objects keep their field order and labels", () => {
    const node = nodeForSetting("grievance_officer") as Extract<Node, { kind: "object" }>;
    expect(node.fields.map((f) => [f.key, f.label])).toEqual([
      ["name", "Name"],
      ["designation", "Designation"],
      ["email", "Email"],
      ["phone", "Phone"],
    ]);
    const draft = toDraft(node, { name: "A", designation: "B", email: "c@d.in", phone: "1" });
    expect(fromDraft(node, draft).value).toEqual({
      name: "A",
      designation: "B",
      email: "c@d.in",
      phone: "1",
    });
  });

  it("records leave blank rows out and report nested number errors by path", () => {
    const est = nodeForSetting("delivery_estimates_by_zone");
    const draft: Draft = {
      metro_region: { minDays: "2", maxDays: "4" },
      north_east: { minDays: "", maxDays: "" },
      islands: { minDays: "3", maxDays: "x" },
    };
    const { value, errors } = fromDraft(est, draft);
    expect(Object.keys(value as object)).toEqual(["metro_region", "islands"]);
    expect(errors).toEqual({ "islands.maxDays": "Enter a whole number" });
    expect(isBlank(est, {})).toBe(true);
    expect(isBlank(est, draft)).toBe(false);
  });

  it("vibe settings are pick-lists of the real vibes; the cycle is ordered", () => {
    const cycle = nodeForSetting("vibe_cycle") as Extract<Node, { kind: "choices" }>;
    expect(cycle.ordered).toBe(true);
    expect(cycle.options.map((o) => o.value)).toEqual([
      "cute",
      "funky",
      "bold",
      "gothic",
    ]);
    const def = nodeForSetting("default_vibe") as Extract<Node, { kind: "enum" }>;
    expect(def.options.map((o) => o.value)).toContain("random");
  });

  it("humanises keys with acronyms", () => {
    expect(humanize("cod_order_placed")).toBe("COD order placed");
    expect(humanize("out_for_delivery")).toBe("Out for delivery");
    expect(humanize("rto")).toBe("RTO");
    expect(humanize("minDays")).toBe("Fastest (days)");
  });

  it("Markdown-format and address keys are multi-line text", () => {
    for (const key of [
      "policy.processors",
      "policy.rto_handling",
      "registered_address",
      "delay_message",
    ] as const) {
      expect((nodeForSetting(key) as Extract<Node, { kind: "text" }>).multiline, key).toBe(true);
    }
    expect((nodeForSetting("legal_name") as Extract<Node, { kind: "text" }>).multiline).toBe(false);
  });
});
