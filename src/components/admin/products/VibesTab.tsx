"use client";

import { useFieldArray, useFormContext } from "react-hook-form";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  cn,
} from "@/components/admin/ui";
import type { ProductFormValues } from "@/server/services/admin/product-schema";
import type { ProductFormOptions } from "@/server/services/admin/products";

export function VibesTab({ options }: { options: ProductFormOptions }) {
  const { control, register, watch } = useFormContext<ProductFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "vibes" });
  const selected = new Map(fields.map((f, i) => [f.vibeId, i]));
  watch("vibes");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vibes</CardTitle>
        <CardDescription>
          Where the product appears. The featured rank orders it inside a vibe&apos;s featured sets:
          lower numbers come first, blank means not featured.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.vibes.map((vibe) => {
            const index = selected.get(vibe.id);
            const on = index !== undefined;
            return (
              <li
                key={vibe.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-admin-border px-3 py-2.5 transition-colors",
                  on && "border-admin-primary/40 bg-admin-primary-soft/50",
                )}
              >
                <Checkbox
                  id={`vibe-${vibe.slug}`}
                  checked={on}
                  onCheckedChange={(v) => {
                    if (v === true && !on) append({ vibeId: vibe.id, featuredRank: "" });
                    else if (v !== true && on) remove(index);
                  }}
                />
                <Label htmlFor={`vibe-${vibe.slug}`} className="flex-1 text-sm">
                  {vibe.name}
                </Label>
                {on ? (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`rank-${vibe.slug}`}
                      className="text-xs font-normal text-admin-ink-muted"
                    >
                      Featured rank
                    </Label>
                    <Input
                      id={`rank-${vibe.slug}`}
                      inputMode="numeric"
                      placeholder="–"
                      className="tabular h-8 w-16 text-center"
                      {...register(`vibes.${index}.featuredRank`)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
