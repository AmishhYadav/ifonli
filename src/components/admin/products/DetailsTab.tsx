"use client";

import { Check, Loader2, X } from "lucide-react";
import * as React from "react";
import { useFormContext } from "react-hook-form";

import { checkSlugAction } from "@/app/admin/(app)/products/actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  SelectField,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useFieldError,
} from "@/components/admin/ui";
import { slugify, type ProductFormValues } from "@/server/services/admin/product-schema";
import type { ProductFormOptions } from "@/server/services/admin/products";

import { MarkdownPreview } from "./MarkdownPreview";

type SlugState = "idle" | "checking" | "available" | "taken" | "invalid";

export function DetailsTab({
  options,
  productId,
  isNew,
}: {
  options: ProductFormOptions;
  productId?: string;
  isNew: boolean;
}) {
  const { register, setValue, watch, getFieldState, formState } =
    useFormContext<ProductFormValues>();
  const slugError = useFieldError<ProductFormValues>("slug");
  const slug = watch("slug");
  const description = watch("descriptionMd");
  // New products follow the name until the slug is edited by hand.
  const [slugEdited, setSlugEdited] = React.useState(!isNew);
  const [checked, setChecked] = React.useState<{
    slug: string;
    state: Exclude<SlugState, "idle" | "checking">;
  } | null>(null);
  const slugState: SlugState = !slug ? "idle" : checked?.slug === slug ? checked.state : "checking";

  React.useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await checkSlugAction(slug, productId).catch(() => null);
      if (cancelled || !res) return;
      setChecked({ slug, state: !res.valid ? "invalid" : res.available ? "available" : "taken" });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [slug, productId]);

  const nameReg = register("name", {
    onChange: (e) => {
      if (!slugEdited) {
        setValue("slug", slugify(e.target.value), {
          shouldDirty: true,
          shouldValidate: formState.isSubmitted,
        });
      }
    },
  });
  const slugReg = register("slug", { onChange: () => setSlugEdited(true) });
  const nameState = getFieldState("name", formState);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Name" htmlFor="f-name" required error={nameState.error?.message}>
              <Input id="f-name" aria-invalid={!!nameState.error} {...nameReg} />
            </Field>
            <Field
              label="URL slug"
              htmlFor="f-slug"
              required
              error={
                slugError ??
                (slugState === "taken" ? "This slug is already used by another product" : undefined)
              }
              hint={slug ? `Storefront path: /products/${slug}` : undefined}
            >
              <div className="relative">
                <Input
                  id="f-slug"
                  aria-invalid={!!slugError || slugState === "taken"}
                  className="pr-9"
                  {...slugReg}
                />
                <span className="absolute top-1/2 right-2.5 -translate-y-1/2" aria-live="polite">
                  {slugState === "checking" ? (
                    <Loader2
                      className="size-4 animate-spin text-admin-ink-faint"
                      aria-label="Checking"
                    />
                  ) : slugState === "available" ? (
                    <Check className="size-4 text-admin-success" aria-label="Available" />
                  ) : slugState === "taken" ? (
                    <X className="size-4 text-admin-danger" aria-label="Taken" />
                  ) : null}
                </span>
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="write">
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  rows={10}
                  aria-label="Description (Markdown)"
                  placeholder="Describe the product. Markdown is supported: **bold**, lists, links."
                  {...register("descriptionMd")}
                />
                <p className="mt-1.5 text-xs text-admin-ink-muted">
                  Markdown. Avoid material or safety claims you cannot back up (see the copy
                  checklist).
                </p>
              </TabsContent>
              <TabsContent value="preview">
                <MarkdownPreview source={description} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SelectField<ProductFormValues>
              name="status"
              label="Status"
              required
              options={[
                { value: "draft", label: "Draft (hidden)" },
                { value: "active", label: "Active (on the storefront)" },
                { value: "archived", label: "Archived (hidden)" },
              ]}
            />
            <SelectField<ProductFormValues>
              name="typeId"
              label="Product type"
              required
              placeholder="Choose a type"
              options={options.types.map((t) => ({
                value: t.id,
                label: t.active ? t.name : `${t.name} (inactive)`,
              }))}
            />
            <SwitchField<ProductFormValues>
              name="isKit"
              label="Sold as a DIY kit"
              hint="A fixed kit with its own stock and price."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
