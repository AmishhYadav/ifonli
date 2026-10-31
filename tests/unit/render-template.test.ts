import { describe, expect, it } from "vitest";

import { buildTemplateContext } from "@/server/content/context";
import {
  MARK_END,
  MARK_KIND_END,
  MARK_START,
  isTruthy,
  renderTemplate,
  type TemplateContext,
} from "@/server/content/render-template";

const ok = (value: unknown, extra: Partial<TemplateContext[string]> = {}) => ({
  value,
  blocking: false,
  ...extra,
});

const ctx: TemplateContext = {
  legal_name: ok("Acme & Sons <Pvt>"),
  brand_name: ok("IfOnli"),
  flat_fee: ok(9900, { format: "money" }),
  free_threshold: ok(129900, { format: "money" }),
  cod_fee: ok(0, { format: "money" }),
  processing_days: ok(2),
  grievance_officer: ok({ name: "Asha", email: "asha@example.com" }),
  cancellable_statuses: ok(["unfulfilled", "packed"], { format: "fulfillment_statuses" }),
  return_policy_type: ok("no_returns"),
  serviceability_mode: ok("all_india"),
  gstin: ok(null),
  zone_overrides: ok({}),
  cod_enabled: ok(true),
  delay_message: ok(""),
  delivery_estimates_by_zone: ok({ metro_region: { minDays: 2, maxDays: 4 }, islands: { minDays: 7, maxDays: 7 } }),
  "policy.jurisdiction_city": ok("Pune"),
  "policy.processors": ok("- Razorpay\n- Shiprocket", { format: "md" }),
  "policy.working_days": ok("PLACEHOLDER — Working days"),
  "policy.courier_partners": ok("Courier", { blocking: true }),
  support_hours: ok(["Mon", "Tue"]),
};

const render = (src: string, opts?: { preview?: boolean }) => renderTemplate(src, ctx, opts);

describe("variables", () => {
  it("prints strings and numbers, tolerating spaces inside the braces", () => {
    expect(render("{{settings.brand_name}} / {{ settings.processing_days }}").text).toBe("IfOnli / 2");
  });

  it("walks dot paths into objects and into dotted registry keys", () => {
    expect(render("{{settings.grievance_officer.name}} {{settings.policy.jurisdiction_city}}").text).toBe(
      "Asha Pune",
    );
  });

  it("escapes HTML in plain values", () => {
    expect(render("{{settings.legal_name}}").text).toBe("Acme &amp; Sons &lt;Pvt&gt;");
  });

  it("prints money keys as rupees with Indian grouping", () => {
    expect(render("{{settings.flat_fee}} {{settings.free_threshold}} {{settings.cod_fee}}").text).toBe(
      "₹99 ₹1,299 ₹0",
    );
  });

  it("joins arrays with a comma and space", () => {
    expect(render("{{settings.support_hours}}").text).toBe("Mon, Tue");
  });

  it("maps cancellable_statuses through the customer label map", () => {
    expect(render("{{settings.cancellable_statuses}}").text).toBe("Confirmed, Packed");
  });

  it("de-duplicates labels that several statuses share", () => {
    const c: TemplateContext = {
      cancellable_statuses: ok(["shipped", "rto", "out_for_delivery"], { format: "fulfillment_statuses" }),
    };
    expect(renderTemplate("{{settings.cancellable_statuses}}", c).text).toBe("Shipped, Out for delivery");
  });

  it("inserts md strings as Markdown source, unescaped", () => {
    expect(render("{{settings.policy.processors}}").text).toBe("- Razorpay\n- Shiprocket");
  });

  it("prints delivery estimate sub-paths as a day range", () => {
    expect(render("{{settings.delivery_estimates_by_zone.metro_region}}").text).toBe("2 to 4 days");
    expect(render("{{settings.delivery_estimates_by_zone.islands}}").text).toBe("7 days");
  });

  it("strips preview sentinels from values", () => {
    const c: TemplateContext = { x: ok(`a${MARK_START}b${MARK_END}`) };
    expect(renderTemplate("{{settings.x}}", c).text).toBe("ab");
  });

  it("prints booleans as yes/no", () => {
    expect(render("{{settings.cod_enabled}}").text).toBe("yes");
  });
});

describe("problems", () => {
  it("reports unresolved paths and leaves nothing in production output", () => {
    const r = render("a {{settings.nope}} b {{settings.grievance_officer.phone}} c");
    expect(r.text).toBe("a  b  c");
    expect(r.problems.map((p) => [p.kind, p.token])).toEqual([
      ["unresolved", "settings.nope"],
      ["unresolved", "settings.grievance_officer.phone"],
    ]);
  });

  it("treats a null value as unresolved", () => {
    expect(render("{{settings.gstin}}").problems[0]?.kind).toBe("unresolved");
  });

  it("flags PLACEHOLDER text and blocking placeholders, once per token", () => {
    const r = render("{{settings.policy.working_days}} {{settings.policy.working_days}} {{settings.policy.courier_partners}}");
    expect(r.problems.map((p) => [p.kind, p.token])).toEqual([
      ["placeholder", "settings.policy.working_days"],
      ["placeholder", "settings.policy.courier_partners"],
    ]);
  });

  it("flags tokens that are not settings.* variables", () => {
    const r = render("{{foo}} {{#each x}}");
    expect(r.problems.map((p) => p.kind)).toEqual(["syntax", "syntax"]);
  });

  it("flags objects that are not estimates", () => {
    expect(render("{{settings.zone_overrides}}").problems[0]?.kind).toBe("unsupported");
  });

  it("marks problems visibly in preview mode", () => {
    const r = render("{{settings.nope}} {{settings.policy.working_days}}", { preview: true });
    expect(r.text).toBe(
      `${MARK_START}unresolved${MARK_KIND_END}{{settings.nope}}${MARK_END} ${MARK_START}placeholder${MARK_KIND_END}PLACEHOLDER — Working days${MARK_END}`,
    );
  });

  it("does not evaluate tokens inside the branch that is not shown", () => {
    const r = render('{{#if settings.return_policy_type == "returns_window"}}{{settings.nope}}{{/if}}');
    expect(r.problems).toEqual([]);
    expect(r.text).toBe("");
  });

  it("reports unknown settings and blocking placeholders used in conditions", () => {
    expect(render("{{#if settings.nope}}x{{/if}}").problems[0]).toMatchObject({ kind: "unresolved" });
    expect(render("{{#if settings.policy.courier_partners}}x{{/if}}").problems[0]).toMatchObject({
      kind: "placeholder",
    });
  });
});

describe("conditionals", () => {
  it("truthiness: false for missing, null, false, 0, empty string, empty array and empty object", () => {
    for (const v of [undefined, null, false, 0, "", [], {}]) expect(isTruthy(v)).toBe(false);
    for (const v of [true, 1, "x", ["a"], { a: 1 }]) expect(isTruthy(v)).toBe(true);
    const text = (path: string) => render(`{{#if settings.${path}}}Y{{else}}N{{/if}}`).text;
    expect(text("gstin")).toBe("N");
    expect(text("delay_message")).toBe("N");
    expect(text("zone_overrides")).toBe("N");
    expect(text("cod_fee")).toBe("N");
    expect(text("cod_enabled")).toBe("Y");
    expect(text("cancellable_statuses")).toBe("Y");
    expect(text("grievance_officer.nothing")).toBe("N");
  });

  it("supports == and != against a double-quoted string", () => {
    expect(render('{{#if settings.serviceability_mode == "all_india"}}A{{else}}B{{/if}}').text).toBe("A");
    expect(render('{{#if settings.serviceability_mode == "allowlist"}}A{{else}}B{{/if}}').text).toBe("B");
    expect(render('{{#if settings.serviceability_mode != "allowlist"}}A{{else}}B{{/if}}').text).toBe("A");
    expect(render('{{#if settings.processing_days == "2"}}A{{else}}B{{/if}}').text).toBe("A");
  });

  it("makes else optional", () => {
    expect(render("{{#if settings.gstin}}GST{{/if}}done").text).toBe("done");
  });

  it("renders variables inside the shown branch", () => {
    expect(render("{{#if settings.cod_enabled}}Fee {{settings.flat_fee}}{{/if}}").text).toBe("Fee ₹99");
  });

  it("removes a tag that is alone on its line, with its newline", () => {
    const src = [
      "before",
      '{{#if settings.return_policy_type == "no_returns"}}',
      "no returns",
      "{{else}}",
      "returns",
      "{{/if}}",
      "after",
      "",
    ].join("\n");
    expect(render(src).text).toBe("before\nno returns\nafter\n");
  });

  it("also removes indented and CRLF own-line tags", () => {
    expect(render("a\r\n  {{#if settings.cod_enabled}}  \r\nb\r\n{{/if}}\r\nc").text).toBe("a\r\nb\r\nc");
  });

  it("keeps inline tags inline", () => {
    expect(render("x {{#if settings.cod_enabled}}yes{{else}}no{{/if}} z").text).toBe("x yes z");
  });

  it("handles tags at the very start and end of the source", () => {
    expect(render("{{#if settings.cod_enabled}}\nA\n{{/if}}").text).toBe("A\n");
  });

  it("rejects nesting, stray else/endif and unclosed blocks", () => {
    const nested = render("{{#if settings.cod_enabled}}{{#if settings.cod_enabled}}x{{/if}}{{/if}}");
    expect(nested.problems.some((p) => p.kind === "syntax")).toBe(true);
    expect(render("{{else}}").problems[0]?.kind).toBe("syntax");
    expect(render("{{/if}}").problems[0]?.kind).toBe("syntax");
    expect(render("{{#if settings.cod_enabled}}x").problems[0]?.kind).toBe("syntax");
    expect(render("{{#if settings.cod_enabled}}a{{else}}b{{else}}c{{/if}}").problems[0]?.kind).toBe("syntax");
  });

  it("rejects unsupported expressions", () => {
    expect(render("{{#if settings.a && settings.b}}x{{/if}}").problems[0]?.kind).toBe("syntax");
    expect(render("{{#if !settings.cod_enabled}}x{{/if}}").problems[0]?.kind).toBe("syntax");
    expect(render("{{#if settings.processing_days == 2}}x{{/if}}").problems[0]?.kind).toBe("syntax");
  });
});

describe("buildTemplateContext", () => {
  it("blocks only placeholders that are required for launch, honouring requiredUnless", () => {
    const entries = [
      { key: "legal_name", value: "PLACEHOLDER — Legal entity name", isPlaceholder: true },
      { key: "brand_name", value: "IfOnli", isPlaceholder: true },
      { key: "support_email", value: "a@b.co", isPlaceholder: false },
      { key: "return_policy_type", value: "no_returns", isPlaceholder: false },
      { key: "policy.return_conditions", value: "PLACEHOLDER", isPlaceholder: true },
      { key: "flat_fee", value: 0, isPlaceholder: true },
    ] as const;
    const c = buildTemplateContext(entries);
    expect(c.legal_name?.blocking).toBe(true);
    expect(c.brand_name?.blocking).toBe(false);
    expect(c.support_email?.blocking).toBe(false);
    expect(c["policy.return_conditions"]?.blocking).toBe(false);
    expect(c["policy.return_conditions"]?.format).toBe("md");
    expect(c.flat_fee).toMatchObject({ blocking: true, format: "money" });

    const withReturns = buildTemplateContext(
      entries.map((e) => (e.key === "return_policy_type" ? { ...e, value: "returns_window" } : e)),
    );
    expect(withReturns["policy.return_conditions"]?.blocking).toBe(true);
  });
});
