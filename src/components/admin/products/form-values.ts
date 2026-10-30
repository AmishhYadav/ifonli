import type { AdminProductDetail, ProductFormOptions } from "@/server/services/admin/products";
import {
  bpToGstPercent,
  formatRupees,
  type ProductFormValues,
} from "@/server/services/admin/product-schema";

export type FormVariant = ProductFormValues["variants"][number];

export function blankVariant(sku = "", optionValues: string[] = []): FormVariant {
  return {
    sku,
    title: "Default",
    optionValues,
    price: "",
    mrp: "",
    weightG: "",
    lowStockThreshold: "",
    active: true,
    initialStock: "0",
  };
}

export function emptyFormValues(options: ProductFormOptions): ProductFormValues {
  return {
    name: "",
    slug: "",
    descriptionMd: "",
    typeId: options.types.find((t) => t.active)?.id ?? "",
    status: "draft",
    isKit: false,
    vibes: [],
    options: [],
    variants: [blankVariant()],
    seoTitle: "",
    seoDesc: "",
    hsnCode: "",
    gstRatePercent: "",
    countryOfOrigin: "",
    netQuantity: "",
    dimensions: "",
    manufacturerName: "",
    manufacturerAddress: "",
  };
}

export function detailToFormValues(d: AdminProductDetail): ProductFormValues {
  return {
    name: d.name,
    slug: d.slug,
    descriptionMd: d.descriptionMd ?? "",
    typeId: d.typeId,
    status: d.status,
    isKit: d.isKit,
    vibes: d.vibes.map((v) => ({
      vibeId: v.vibeId,
      featuredRank: v.featuredRank === null ? "" : String(v.featuredRank),
    })),
    options: d.options.map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({ id: v.id, value: v.value, swatchHex: v.swatchHex ?? "" })),
    })),
    variants: d.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      optionValues: v.optionValues,
      price: formatRupees(v.pricePaise),
      mrp: formatRupees(v.mrpPaise),
      weightG: v.weightG === null ? "" : String(v.weightG),
      lowStockThreshold: v.lowStockThreshold === null ? "" : String(v.lowStockThreshold),
      active: v.active,
      initialStock: "0",
      hasHistory: v.hasHistory,
      onHand: v.onHand,
    })),
    seoTitle: d.seoTitle ?? "",
    seoDesc: d.seoDesc ?? "",
    hsnCode: d.hsnCode ?? "",
    gstRatePercent: bpToGstPercent(d.gstRateBp),
    countryOfOrigin: d.countryOfOrigin ?? "",
    netQuantity: d.netQuantity ?? "",
    dimensions: d.dimensions ?? "",
    manufacturerName: d.manufacturerOverride?.name ?? "",
    manufacturerAddress: d.manufacturerOverride?.address ?? "",
  };
}

/** `HEART-CHARM-PINK` style suggestion for generated variants. */
export function suggestSku(slug: string, optionValues: readonly string[]): string {
  const part = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return [part(slug), ...optionValues.map(part)].filter(Boolean).join("-");
}
