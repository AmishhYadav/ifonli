"use client";

import { useFormContext } from "react-hook-form";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Textarea,
  cn,
} from "@/components/admin/ui";
import {
  SEO_DESC_MAX,
  SEO_TITLE_MAX,
  type ProductFormValues,
} from "@/server/services/admin/product-schema";

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span
      className={cn("tabular text-xs", value > max ? "text-admin-danger" : "text-admin-ink-muted")}
    >
      {value}/{max}
    </span>
  );
}

export function SeoTab({ siteHost }: { siteHost: string }) {
  const { register, watch } = useFormContext<ProductFormValues>();
  const [name, slug, descriptionMd, seoTitle, seoDesc] = watch([
    "name",
    "slug",
    "descriptionMd",
    "seoTitle",
    "seoDesc",
  ]);

  const plainDescription = descriptionMd
    .replace(/[#*_`>[\]()-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const shownTitle = (seoTitle || name || "Product title").trim();
  const shownDesc = (
    seoDesc ||
    plainDescription ||
    "Add a description or SEO description to control this snippet."
  ).trim();
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Card>
        <CardHeader>
          <CardTitle>Search appearance</CardTitle>
          <CardDescription>Leave blank to use the product name and description.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            label="SEO title"
            htmlFor="f-seoTitle"
            hint={<Counter value={seoTitle.length} max={SEO_TITLE_MAX} />}
          >
            <Input id="f-seoTitle" {...register("seoTitle")} />
          </Field>
          <Field
            label="SEO description"
            htmlFor="f-seoDesc"
            hint={<Counter value={seoDesc.length} max={SEO_DESC_MAX} />}
          >
            <Textarea id="f-seoDesc" rows={4} {...register("seoDesc")} />
          </Field>
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle>Google preview</CardTitle>
          <CardDescription>Approximate; Google may rewrite the snippet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="serp rounded-lg border border-admin-border p-4"
            aria-label="Search result preview"
          >
            <p className="truncate text-xs">
              {siteHost} › products › {slug || "slug"}
            </p>
            <p className="serp-title mt-0.5">{clip(shownTitle, SEO_TITLE_MAX)}</p>
            <p className="mt-0.5 text-sm leading-snug">{clip(shownDesc, SEO_DESC_MAX)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
