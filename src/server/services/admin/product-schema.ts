/**
 * Pure helpers and validation for the products admin (no `server-only`, no DB), shared by the
 * client form (field validation) and the Server Actions / service (authoritative validation).
 *
 * Money: the UI works in rupees as text ("199", "1,299.50"); everything stored and validated on
 * the server is integer paise. `parseRupees` never goes through floats.
 */
import { z } from "zod";

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const MAX_PAISE = 10_000_000_00; // 1 crore rupees: far above any real price, far below 2^53
export const MAX_VARIANTS = 100;
export const MAX_OPTIONS = 3;
export const SEO_TITLE_MAX = 70;
export const SEO_DESC_MAX = 170;

// ---------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------

/** Lowercase, accent-folded, hyphen-separated slug ("Skull Charm!" -> "skull-charm"). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * Rupee text to integer paise, or null if it is not a valid amount. Accepts "199", "199.5",
 * "1,299.50", "₹ 99", up to 2 decimals; rejects negatives, exponents and 3+ decimals.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹\s,]/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return paise <= MAX_PAISE ? paise : null;
}

/** Paise to the text an input shows: "199" for whole rupees, otherwise "199.50". */
export function formatRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return rem === 0 ? String(rupees) : `${rupees}.${String(rem).padStart(2, "0")}`;
}

/** GST percent text ("18", "5.5") to basis points; null for blank (= store default). */
export function gstPercentToBp(input: string): number | null | "invalid" {
  const t = input.trim().replace(/%$/, "").trim();
  if (t === "") return null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return "invalid";
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bp <= 10_000 ? bp : "invalid";
}

export function bpToGstPercent(bp: number | null): string {
  return bp === null ? "" : formatRupees(bp);
}

/** Variant title from its option values ("Pink / Small"); "Default" when there are none. */
export function variantTitleFor(optionValues: readonly string[]): string {
  const parts = optionValues.map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts.join(" / ") : "Default";
}

/** Cartesian product of option values, in option order. */
export function combinations<T>(lists: readonly (readonly T[])[]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])),
    [[]],
  );
}

// ---------------------------------------------------------------------------------------------
// Server-side (authoritative) input
// ---------------------------------------------------------------------------------------------

const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

export const variantInputSchema = z
  .object({
    id: z.uuid().optional(),
    sku: z
      .string()
      .trim()
      .min(2, "SKU is required")
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Letters, numbers, dot, dash, underscore")
      .transform((s) => s.toUpperCase()),
    title: z.string().trim().min(1).max(120),
    /** One value label per option, in option order. */
    optionValues: z.array(z.string().trim().min(1)).max(MAX_OPTIONS),
    pricePaise: z.number().int().min(0).max(MAX_PAISE),
    mrpPaise: z.number().int().min(0).max(MAX_PAISE),
    weightG: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullish()
      .transform((v) => v ?? null),
    lowStockThreshold: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .nullish()
      .transform((v) => v ?? null),
    active: z.boolean(),
    /** Opening stock for a NEW variant only (written through `adjustStock`). Ignored for existing. */
    initialStock: z.number().int().min(0).max(1_000_000).default(0),
  })
  .refine((v) => v.pricePaise <= v.mrpPaise, {
    path: ["pricePaise"],
    message: "Price cannot be higher than MRP",
  });
export type VariantInput = z.output<typeof variantInputSchema>;

export const optionInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Option name is required").max(40),
  values: z
    .array(
      z.object({
        id: z.uuid().optional(),
        value: z.string().trim().min(1, "Value is required").max(60),
        swatchHex: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, "Use #RRGGBB")
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .min(1, "Add at least one value")
    .max(30),
});
export type OptionInput = z.output<typeof optionInputSchema>;

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    slug: slugSchema,
    descriptionMd: nullableText(20_000),
    typeId: z.uuid("Choose a product type"),
    status: z.enum(PRODUCT_STATUSES),
    isKit: z.boolean(),
    seoTitle: nullableText(200),
    seoDesc: nullableText(400),
    hsnCode: nullableText(16),
    gstRateBp: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .nullish()
      .transform((v) => v ?? null),
    countryOfOrigin: nullableText(80),
    netQuantity: nullableText(80),
    dimensions: nullableText(80),
    manufacturerOverride: z
      .object({ name: z.string().trim().min(1), address: z.string().trim().min(1) })
      .nullish()
      .transform((v) => v ?? null),
    vibes: z
      .array(
        z.object({
          vibeId: z.uuid(),
          featuredRank: z
            .number()
            .int()
            .min(0)
            .max(100_000)
            .nullish()
            .transform((v) => v ?? null),
        }),
      )
      .max(20),
    options: z.array(optionInputSchema).max(MAX_OPTIONS),
    variants: z.array(variantInputSchema).min(1, "Add at least one variant").max(MAX_VARIANTS),
  })
  .superRefine((p, ctx) => {
    const add = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const seenVibes = new Set<string>();
    p.vibes.forEach((v, i) => {
      if (seenVibes.has(v.vibeId)) add(["vibes", i, "vibeId"], "Vibe listed twice");
      seenVibes.add(v.vibeId);
    });

    const optionNames = new Set<string>();
    p.options.forEach((o, i) => {
      const key = o.name.toLowerCase();
      if (optionNames.has(key)) add(["options", i, "name"], "Duplicate option name");
      optionNames.add(key);
      const values = new Set<string>();
      o.values.forEach((val, j) => {
        const vk = val.value.toLowerCase();
        if (values.has(vk)) add(["options", i, "values", j, "value"], "Duplicate value");
        values.add(vk);
      });
    });

    if (p.options.length === 0 && p.variants.length > 1) {
      add(["variants"], "Add an option (for example Colour) before adding more than one variant");
    }

    const skus = new Set<string>();
    const combos = new Set<string>();
    p.variants.forEach((v, i) => {
      if (skus.has(v.sku)) add(["variants", i, "sku"], "SKU used twice");
      skus.add(v.sku);
      if (v.optionValues.length !== p.options.length) {
        add(["variants", i, "optionValues"], "Pick a value for every option");
        return;
      }
      v.optionValues.forEach((label, k) => {
        const option = p.options[k]!;
        if (!option.values.some((x) => x.value.toLowerCase() === label.toLowerCase())) {
          add(["variants", i, "optionValues", k], `"${label}" is not a value of ${option.name}`);
        }
      });
      const comboKey = v.optionValues.map((x) => x.toLowerCase()).join("\u0000");
      if (p.options.length > 0 && combos.has(comboKey)) {
        add(["variants", i, "optionValues"], "Another variant has this combination");
      }
      combos.add(comboKey);
    });

    if (p.status === "active" && !p.variants.some((v) => v.active)) {
      add(["status"], "Activate at least one variant before publishing");
    }
  });
export type ProductInput = z.output<typeof productInputSchema>;

export const imageKindSchema = z.enum(["photo", "cutout"]);
export const altTextSchema = z.string().trim().min(1, "Alt text is required").max(300);

// ---------------------------------------------------------------------------------------------
// Client form (strings) -> server input
// ---------------------------------------------------------------------------------------------

const rupeeText = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => parseRupees(v) !== null, `${label} must be an amount like 199 or 199.50`);
const intText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (/^\d+$/.test(v) && Number(v) <= max),
      `${label} must be a whole number`,
    );

const productFormShape = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  slug: slugSchema,
  descriptionMd: z.string().max(20_000),
  typeId: z.string().min(1, "Choose a product type"),
  status: z.enum(PRODUCT_STATUSES),
  isKit: z.boolean(),
  vibes: z.array(z.object({ vibeId: z.string().min(1), featuredRank: intText("Rank", 100_000) })),
  options: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1, "Option name is required").max(40),
        values: z
          .array(
            z.object({
              id: z.string().optional(),
              value: z.string().trim().min(1, "Value is required").max(60),
              swatchHex: z
                .string()
                .trim()
                .refine((v) => v === "" || /^#[0-9A-Fa-f]{6}$/.test(v), "Use #RRGGBB"),
            }),
          )
          .min(1, "Add at least one value"),
      }),
    )
    .max(MAX_OPTIONS),
  variants: z
    .array(
      z
        .object({
          id: z.string().optional(),
          sku: z
            .string()
            .trim()
            .min(2, "SKU is required")
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Letters, numbers, dot, dash, underscore"),
          title: z.string().trim().max(120),
          optionValues: z.array(z.string()),
          price: rupeeText("Price"),
          mrp: rupeeText("MRP"),
          weightG: intText("Weight", 1_000_000),
          lowStockThreshold: intText("Threshold", 100_000),
          active: z.boolean(),
          initialStock: intText("Stock", 1_000_000),
          hasHistory: z.boolean().optional(),
          onHand: z.number().optional(),
        })
        .superRefine((v, ctx) => {
          const price = parseRupees(v.price);
          const mrp = parseRupees(v.mrp);
          if (price !== null && mrp !== null && price > mrp) {
            ctx.addIssue({ code: "custom", path: ["price"], message: "Price cannot be above MRP" });
          }
        }),
    )
    .min(1, "Add at least one variant"),
  seoTitle: z.string().max(200),
  seoDesc: z.string().max(400),
  hsnCode: z.string().max(16),
  gstRatePercent: z
    .string()
    .refine((v) => gstPercentToBp(v) !== "invalid", "GST rate must be between 0 and 100"),
  countryOfOrigin: z.string().max(80),
  netQuantity: z.string().max(80),
  dimensions: z.string().max(80),
  manufacturerName: z.string().max(200),
  manufacturerAddress: z.string().max(500),
});
export type ProductFormValues = z.infer<typeof productFormShape>;

const toInt = (v: string): number | null => (v.trim() === "" ? null : Number(v));

/** Converts validated form values to the payload the Server Action sends. */
export function formToInput(f: ProductFormValues): z.input<typeof productInputSchema> {
  const gst = gstPercentToBp(f.gstRatePercent);
  const hasMfr = f.manufacturerName.trim() || f.manufacturerAddress.trim();
  return {
    name: f.name,
    slug: f.slug,
    descriptionMd: f.descriptionMd,
    typeId: f.typeId,
    status: f.status,
    isKit: f.isKit,
    seoTitle: f.seoTitle,
    seoDesc: f.seoDesc,
    hsnCode: f.hsnCode,
    gstRateBp: gst === "invalid" ? null : gst,
    countryOfOrigin: f.countryOfOrigin,
    netQuantity: f.netQuantity,
    dimensions: f.dimensions,
    manufacturerOverride: hasMfr
      ? { name: f.manufacturerName, address: f.manufacturerAddress }
      : null,
    vibes: f.vibes.map((v) => ({ vibeId: v.vibeId, featuredRank: toInt(v.featuredRank) })),
    options: f.options.map((o) => ({
      id: o.id || undefined,
      name: o.name,
      values: o.values.map((v) => ({
        id: v.id || undefined,
        value: v.value,
        swatchHex: v.swatchHex.trim() || null,
      })),
    })),
    variants: f.variants.map((v) => ({
      id: v.id || undefined,
      sku: v.sku,
      // Titles of option-based variants always follow their option values ("Pink / Small").
      title: f.options.length ? variantTitleFor(v.optionValues) : v.title.trim() || "Default",
      optionValues: v.optionValues,
      pricePaise: parseRupees(v.price) ?? 0,
      mrpPaise: parseRupees(v.mrp) ?? 0,
      weightG: toInt(v.weightG),
      lowStockThreshold: toInt(v.lowStockThreshold),
      active: v.active,
      initialStock: v.id ? 0 : (toInt(v.initialStock) ?? 0),
    })),
  };
}

/** Maps a server issue path (`["variants", 0, "pricePaise"]`) to the form's field path. */
export function mapIssuePath(path: readonly PropertyKey[]): (string | number)[] {
  const rename: Record<string, string> = {
    pricePaise: "price",
    mrpPaise: "mrp",
    gstRateBp: "gstRatePercent",
    manufacturerOverride: "manufacturerName",
  };
  return path.map((p) => (typeof p === "number" ? p : (rename[String(p)] ?? String(p))));
}

/**
 * Form schema: per-field text checks first, then the SAME rules the server enforces
 * (`productInputSchema`: unique SKUs, option combinations, price <= MRP, active needs a variant ...)
 * so the client shows server-grade errors on the right field before submitting.
 */
export const productFormSchema = productFormShape.superRefine((f, ctx) => {
  const result = productInputSchema.safeParse(formToInput(f));
  if (result.success) return;
  const seen = new Set<string>();
  for (const issue of result.error.issues) {
    const path = mapIssuePath(issue.path);
    const key = `${path.join(".")}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.addIssue({ code: "custom", path, message: issue.message });
  }
});

/** Shallow before/after diff of the changed keys (for audit rows). */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

/** Maps a server validation path (`variants.0.pricePaise`) to the matching form field name. */
export function serverPathToFormPath(path: string): string {
  return path
    .replace(/\.pricePaise$/, ".price")
    .replace(/\.mrpPaise$/, ".mrp")
    .replace(/^gstRateBp$/, "gstRatePercent")
    .replace(/^manufacturerOverride(\..*)?$/, "manufacturerName");
}
