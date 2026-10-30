import { describe, expect, it } from "vitest";

import {
  bpToGstPercent,
  combinations,
  diffFields,
  formToInput,
  formatRupees,
  gstPercentToBp,
  mapIssuePath,
  parseRupees,
  productFormSchema,
  productInputSchema,
  serverPathToFormPath,
  slugify,
  variantTitleFor,
  type ProductFormValues,
} from "@/server/services/admin/product-schema";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("slugify", () => {
  it("lowercases, folds accents and hyphenates", () => {
    expect(slugify("Skull Charm!")).toBe("skull-charm");
    expect(slugify("  Café   au lait & more ")).toBe("cafe-au-lait-and-more");
    expect(slugify('Letter beads "IF"')).toBe("letter-beads-if");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(120)).length).toBeLessThanOrEqual(80);
  });
});

describe("rupees <-> paise", () => {
  it("parses amounts without floats", () => {
    expect(parseRupees("199")).toBe(19900);
    expect(parseRupees("199.5")).toBe(19950);
    expect(parseRupees("1,299.05")).toBe(129905);
    expect(parseRupees("₹ 99")).toBe(9900);
    expect(parseRupees("0.29")).toBe(29);
    expect(parseRupees("1.005")).toBeNull();
    expect(parseRupees("-5")).toBeNull();
    expect(parseRupees("1e3")).toBeNull();
    expect(parseRupees("")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
    expect(parseRupees("99999999999")).toBeNull();
  });

  it("formats paise for inputs and round-trips", () => {
    expect(formatRupees(19900)).toBe("199");
    expect(formatRupees(19950)).toBe("199.50");
    expect(formatRupees(5)).toBe("0.05");
    for (const p of [0, 1, 99, 100, 12345, 129905]) expect(parseRupees(formatRupees(p))).toBe(p);
  });

  it("converts GST percent to basis points", () => {
    expect(gstPercentToBp("18")).toBe(1800);
    expect(gstPercentToBp("5.5%")).toBe(550);
    expect(gstPercentToBp("")).toBeNull();
    expect(gstPercentToBp("100")).toBe(10000);
    expect(gstPercentToBp("101")).toBe("invalid");
    expect(gstPercentToBp("x")).toBe("invalid");
    expect(bpToGstPercent(1800)).toBe("18");
    expect(bpToGstPercent(null)).toBe("");
  });
});

describe("small helpers", () => {
  it("builds combinations, titles and diffs", () => {
    expect(
      combinations([
        ["a", "b"],
        ["1", "2"],
      ]),
    ).toEqual([
      ["a", "1"],
      ["a", "2"],
      ["b", "1"],
      ["b", "2"],
    ]);
    expect(combinations([])).toEqual([[]]);
    expect(variantTitleFor(["Pink", " Small "])).toBe("Pink / Small");
    expect(variantTitleFor([])).toBe("Default");
    expect(diffFields({ a: 1, b: "x" }, { a: 2, b: "x", d: 4 })).toEqual({
      a: { from: 1, to: 2 },
      d: { from: null, to: 4 },
    });
  });

  it("maps server paths to form field names", () => {
    expect(serverPathToFormPath("variants.0.pricePaise")).toBe("variants.0.price");
    expect(serverPathToFormPath("variants.2.mrpPaise")).toBe("variants.2.mrp");
    expect(serverPathToFormPath("gstRateBp")).toBe("gstRatePercent");
    expect(serverPathToFormPath("manufacturerOverride.name")).toBe("manufacturerName");
    expect(mapIssuePath(["variants", 1, "pricePaise"])).toEqual(["variants", 1, "price"]);
  });
});

function validInput(over: Record<string, unknown> = {}) {
  return {
    name: "Heart",
    slug: "heart",
    descriptionMd: "",
    typeId: UUID,
    status: "draft",
    isKit: false,
    vibes: [],
    options: [],
    variants: [
      {
        sku: "h-1",
        title: "Default",
        optionValues: [],
        pricePaise: 100,
        mrpPaise: 100,
        active: true,
      },
    ],
    ...over,
  };
}

describe("productInputSchema", () => {
  it("normalises blanks to null, uppercases SKUs and defaults stock", () => {
    const out = productInputSchema.parse(
      validInput({ descriptionMd: "  ", hsnCode: "", gstRateBp: undefined }),
    );
    expect(out.descriptionMd).toBeNull();
    expect(out.hsnCode).toBeNull();
    expect(out.gstRateBp).toBeNull();
    expect(out.variants[0]).toMatchObject({
      sku: "H-1",
      initialStock: 0,
      weightG: null,
      lowStockThreshold: null,
    });
  });

  it("enforces price <= MRP, slug format and non-negative integers", () => {
    const bad = (over: Record<string, unknown>) =>
      productInputSchema.safeParse(validInput(over)).success;
    expect(
      bad({
        variants: [
          {
            sku: "h-1",
            title: "D",
            optionValues: [],
            pricePaise: 101,
            mrpPaise: 100,
            active: true,
          },
        ],
      }),
    ).toBe(false);
    expect(
      bad({
        variants: [
          {
            sku: "h-1",
            title: "D",
            optionValues: [],
            pricePaise: 1.5,
            mrpPaise: 100,
            active: true,
          },
        ],
      }),
    ).toBe(false);
    expect(
      bad({
        variants: [
          { sku: "h-1", title: "D", optionValues: [], pricePaise: -1, mrpPaise: 100, active: true },
        ],
      }),
    ).toBe(false);
    expect(bad({ slug: "Not A Slug" })).toBe(false);
    expect(bad({ gstRateBp: 10001 })).toBe(false);
    expect(bad({})).toBe(true);
  });

  it("checks option structure and combinations", () => {
    const opts = [{ name: "Colour", values: [{ value: "Pink" }, { value: "Red" }] }];
    const v = (sku: string, label: string) => ({
      sku,
      title: "x",
      optionValues: [label],
      pricePaise: 1,
      mrpPaise: 1,
      active: true,
    });
    expect(
      productInputSchema.safeParse(
        validInput({ options: opts, variants: [v("a-1", "Pink"), v("a-2", "Red")] }),
      ).success,
    ).toBe(true);
    // unknown value, duplicate combination, duplicate SKU, duplicate option name
    expect(
      productInputSchema.safeParse(validInput({ options: opts, variants: [v("a-1", "Blue")] }))
        .success,
    ).toBe(false);
    expect(
      productInputSchema.safeParse(
        validInput({ options: opts, variants: [v("a-1", "Pink"), v("a-2", "pink")] }),
      ).success,
    ).toBe(false);
    expect(
      productInputSchema.safeParse(
        validInput({ options: opts, variants: [v("a-1", "Pink"), v("A-1", "Red")] }),
      ).success,
    ).toBe(false);
    expect(
      productInputSchema.safeParse(
        validInput({ options: [...opts, ...opts], variants: [v("a-1", "Pink")] }),
      ).success,
    ).toBe(false);
    // several variants without options
    expect(
      productInputSchema.safeParse(
        validInput({
          variants: [v("a-1", "x"), v("a-2", "y")].map((x) => ({ ...x, optionValues: [] })),
        }),
      ).success,
    ).toBe(false);
  });

  it("requires an active variant for an active product, and both manufacturer fields", () => {
    const inactive = [
      { sku: "h-1", title: "D", optionValues: [], pricePaise: 1, mrpPaise: 1, active: false },
    ];
    expect(
      productInputSchema.safeParse(validInput({ status: "active", variants: inactive })).success,
    ).toBe(false);
    expect(
      productInputSchema.safeParse(validInput({ status: "draft", variants: inactive })).success,
    ).toBe(true);
    expect(
      productInputSchema.safeParse(validInput({ manufacturerOverride: { name: "X", address: "" } }))
        .success,
    ).toBe(false);
  });
});

function validForm(over: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    name: "Heart",
    slug: "heart",
    descriptionMd: "",
    typeId: UUID,
    status: "draft",
    isKit: false,
    vibes: [{ vibeId: UUID, featuredRank: "3" }],
    options: [],
    variants: [
      {
        sku: "h-1",
        title: "Default",
        optionValues: [],
        price: "199",
        mrp: "249.50",
        weightG: "12",
        lowStockThreshold: "",
        active: true,
        initialStock: "7",
      },
    ],
    seoTitle: "",
    seoDesc: "",
    hsnCode: "",
    gstRatePercent: "18",
    countryOfOrigin: "",
    netQuantity: "",
    dimensions: "",
    manufacturerName: "",
    manufacturerAddress: "",
    ...over,
  };
}

describe("productFormSchema + formToInput", () => {
  it("converts rupee text to paise, percent to basis points, blanks to null", () => {
    const form = validForm();
    expect(productFormSchema.safeParse(form).success).toBe(true);
    const out = productInputSchema.parse(formToInput(form));
    expect(out.variants[0]).toMatchObject({
      pricePaise: 19900,
      mrpPaise: 24950,
      weightG: 12,
      initialStock: 7,
    });
    expect(out.gstRateBp).toBe(1800);
    expect(out.vibes).toEqual([{ vibeId: UUID, featuredRank: 3 }]);
    expect(out.manufacturerOverride).toBeNull();
  });

  it("existing variants never send opening stock; option variants take a generated title", () => {
    const form = validForm({
      options: [{ name: "Colour", values: [{ value: "Pink", swatchHex: "#FF5C8A" }] }],
      variants: [
        {
          id: UUID,
          sku: "h-1",
          title: "stale",
          optionValues: ["Pink"],
          price: "1",
          mrp: "1",
          weightG: "",
          lowStockThreshold: "",
          active: true,
          initialStock: "99",
        },
      ],
    });
    const input = formToInput(form);
    expect(input.variants[0]).toMatchObject({ id: UUID, title: "Pink", initialStock: 0 });
  });

  it("reports price above MRP on the price field, and server rules on the right path", () => {
    const r = productFormSchema.safeParse(
      validForm({
        variants: [
          {
            sku: "h-1",
            title: "",
            optionValues: [],
            price: "300",
            mrp: "249",
            weightG: "",
            lowStockThreshold: "",
            active: true,
            initialStock: "0",
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
    const paths = (r.error?.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toContain("variants.0.price");

    const dup = productFormSchema.safeParse(
      validForm({
        options: [{ name: "Colour", values: [{ value: "Pink", swatchHex: "" }] }],
        variants: [
          {
            sku: "h-1",
            title: "",
            optionValues: ["Pink"],
            price: "1",
            mrp: "1",
            weightG: "",
            lowStockThreshold: "",
            active: true,
            initialStock: "0",
          },
          {
            sku: "h-2",
            title: "",
            optionValues: ["Pink"],
            price: "1",
            mrp: "1",
            weightG: "",
            lowStockThreshold: "",
            active: true,
            initialStock: "0",
          },
        ],
      }),
    );
    expect((dup.error?.issues ?? []).map((i) => i.path.join("."))).toContain(
      "variants.1.optionValues",
    );
  });

  it("rejects bad money text, GST and blank required fields", () => {
    expect(productFormSchema.safeParse(validForm({ name: " " })).success).toBe(false);
    expect(productFormSchema.safeParse(validForm({ gstRatePercent: "180" })).success).toBe(false);
    expect(
      productFormSchema.safeParse(
        validForm({
          variants: [
            {
              sku: "h-1",
              title: "",
              optionValues: [],
              price: "12.345",
              mrp: "20",
              weightG: "",
              lowStockThreshold: "",
              active: true,
              initialStock: "0",
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });
});
