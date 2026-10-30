"use client";

import { Plus, Trash2, Wand2, X } from "lucide-react";
import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@/components/admin/ui";
import {
  MAX_OPTIONS,
  combinations,
  type ProductFormValues,
} from "@/server/services/admin/product-schema";

import { blankVariant, suggestSku } from "./form-values";

function OptionValues({ optionIndex }: { optionIndex: number }) {
  const { control, register, getValues, setValue } = useFormContext<ProductFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: `options.${optionIndex}.values`,
  });
  // Last label seen per value row, so a rename can find the variants that used the old label.
  const [previous, setPrevious] = React.useState<Record<string, string>>({});

  /** Renaming a value keeps the variants that used it pointing at it. */
  function followRename(fieldId: string, next: string) {
    // First edit of a field: its initial value is what `fields` was created with.
    const old = previous[fieldId] ?? fields.find((f) => f.id === fieldId)?.value ?? "";
    setPrevious((p) => ({ ...p, [fieldId]: next }));
    getValues("variants").forEach((v, k) => {
      if (old && v.optionValues[optionIndex] === old) {
        setValue(`variants.${k}.optionValues.${optionIndex}`, next, { shouldDirty: true });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {fields.map((f, vi) => (
        <div key={f.id} className="flex items-center gap-2">
          <Input
            aria-label="Option value"
            placeholder="Value, for example Pink"
            className="h-8 flex-1"
            {...register(`options.${optionIndex}.values.${vi}.value`, {
              onChange: (e) => followRename(f.id, e.target.value),
            })}
          />
          <Input
            aria-label="Swatch colour (optional)"
            placeholder="#RRGGBB"
            className="h-8 w-28 font-mono text-xs"
            {...register(`options.${optionIndex}.values.${vi}.swatchHex`)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove value"
            disabled={fields.length === 1}
            onClick={() => {
              const label = getValues(`options.${optionIndex}.values.${vi}.value`);
              getValues("variants").forEach((v, k) => {
                if (v.optionValues[optionIndex] === label) {
                  setValue(`variants.${k}.optionValues.${optionIndex}`, "", { shouldDirty: true });
                }
              });
              remove(vi);
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => append({ value: "", swatchHex: "" })}
      >
        <Plus aria-hidden /> Add value
      </Button>
    </div>
  );
}

function OptionsEditor() {
  const { control, register, getValues, setValue, formState } = useFormContext<ProductFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "options" });

  function addOption() {
    getValues("variants").forEach((v, k) =>
      setValue(`variants.${k}.optionValues`, [...v.optionValues, ""], { shouldDirty: true }),
    );
    append({ name: "", values: [{ value: "", swatchHex: "" }] });
  }

  function removeOption(index: number) {
    getValues("variants").forEach((v, k) =>
      setValue(
        `variants.${k}.optionValues`,
        v.optionValues.filter((_, i) => i !== index),
        { shouldDirty: true },
      ),
    );
    remove(index);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Options</CardTitle>
        <CardDescription>
          Add options such as Colour or Pack size when the product comes in more than one form. Each
          combination becomes a variant with its own SKU, price and stock.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fields.map((f, oi) => {
          const nameError = formState.errors.options?.[oi]?.name?.message;
          return (
            <div key={f.id} className="rounded-lg border border-admin-border p-3">
              <div className="mb-3 flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    aria-label="Option name"
                    placeholder="Option name, for example Colour"
                    className="h-8 font-medium"
                    aria-invalid={!!nameError}
                    {...register(`options.${oi}.name`)}
                  />
                  {nameError ? <p className="mt-1 text-xs text-admin-danger">{nameError}</p> : null}
                </div>
                <Button variant="danger-outline" size="sm" onClick={() => removeOption(oi)}>
                  <Trash2 aria-hidden /> Remove option
                </Button>
              </div>
              <OptionValues optionIndex={oi} />
            </div>
          );
        })}
        {fields.length < MAX_OPTIONS ? (
          <Button variant="outline" size="sm" className="self-start" onClick={addOption}>
            <Plus aria-hidden /> Add option
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function VariantMatrix() {
  const { control, register, getValues, setValue, formState } = useFormContext<ProductFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });
  const options = useWatch({ control, name: "options" });
  const slug = useWatch({ control, name: "slug" });
  const variants = useWatch({ control, name: "variants" });
  const hasOptions = options.length > 0;
  const err = formState.errors.variants;

  function generate() {
    const lists = options.map((o) => o.values.map((v) => v.value.trim()).filter(Boolean));
    if (lists.some((l) => l.length === 0)) return;
    const have = new Set(
      getValues("variants").map((v) => v.optionValues.map((x) => x.toLowerCase()).join("\u0000")),
    );
    const template = getValues("variants")[0];
    for (const combo of combinations(lists)) {
      if (have.has(combo.map((x) => x.toLowerCase()).join("\u0000"))) continue;
      const v = blankVariant(suggestSku(slug, combo), combo);
      v.price = template?.price ?? "";
      v.mrp = template?.mrp ?? "";
      append(v);
    }
    // Drop an untouched blank placeholder row that the generated combinations replace.
    const current = getValues("variants");
    current.forEach((v, i) => {
      if (!v.id && !v.sku && v.optionValues.every((x) => !x) && current.length > 1) remove(i);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Variants</CardTitle>
          <CardDescription>
            Prices are in rupees and stored in paise. Price cannot be above MRP. Stock changes after
            the first save go through Inventory so the ledger stays correct.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          {hasOptions ? (
            <Button variant="outline" size="sm" onClick={generate}>
              <Wand2 aria-hidden /> Generate combinations
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!hasOptions && fields.length >= 1}
            title={!hasOptions ? "Add an option first to create more than one variant" : undefined}
            onClick={() =>
              append(
                blankVariant(
                  "",
                  options.map(() => ""),
                ),
              )
            }
          >
            <Plus aria-hidden /> Add variant
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {typeof err?.message === "string" ? (
          <p role="alert" className="mx-5 mb-3 text-xs text-admin-danger">
            {err.message}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {options.map((o, oi) => (
                <TableHead key={oi}>{o.name || `Option ${oi + 1}`}</TableHead>
              ))}
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Price ₹</TableHead>
              <TableHead className="text-right">MRP ₹</TableHead>
              <TableHead className="text-right">Weight g</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f, i) => {
              const row = err?.[i];
              const v = variants[i];
              const isNew = !f.id || !v?.id;
              return (
                <TableRow key={f.id} className="align-top">
                  {options.map((o, oi) => (
                    <TableCell key={oi} className="min-w-32">
                      <Select
                        aria-label={`${o.name || "Option"} for variant ${i + 1}`}
                        value={v?.optionValues[oi] ?? ""}
                        onValueChange={(val) =>
                          setValue(`variants.${i}.optionValues.${oi}`, val, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        options={o.values
                          .map((x) => x.value.trim())
                          .filter(Boolean)
                          .map((x) => ({ value: x, label: x }))}
                        placeholder="Select"
                        className="h-8"
                        aria-invalid={!!row?.optionValues}
                      />
                      {row?.optionValues && !Array.isArray(row.optionValues) && oi === 0 ? (
                        <p className="mt-1 text-xs text-admin-danger">
                          {String(row.optionValues.message ?? "")}
                        </p>
                      ) : null}
                    </TableCell>
                  ))}
                  <TableCell className="min-w-36">
                    <Input
                      aria-label={`SKU for variant ${i + 1}`}
                      className="h-8 font-mono text-xs uppercase"
                      aria-invalid={!!row?.sku}
                      {...register(`variants.${i}.sku`)}
                    />
                    {row?.sku ? (
                      <p className="mt-1 text-xs text-admin-danger">{row.sku.message}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="w-28">
                    <Input
                      aria-label={`Price for variant ${i + 1}`}
                      inputMode="decimal"
                      className="tabular h-8 text-right"
                      aria-invalid={!!row?.price}
                      {...register(`variants.${i}.price`)}
                    />
                    {row?.price ? (
                      <p className="mt-1 text-xs text-admin-danger">{row.price.message}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="w-28">
                    <Input
                      aria-label={`MRP for variant ${i + 1}`}
                      inputMode="decimal"
                      className="tabular h-8 text-right"
                      aria-invalid={!!row?.mrp}
                      {...register(`variants.${i}.mrp`)}
                    />
                    {row?.mrp ? (
                      <p className="mt-1 text-xs text-admin-danger">{row.mrp.message}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="w-24">
                    <Input
                      aria-label={`Weight in grams for variant ${i + 1}`}
                      inputMode="numeric"
                      className="tabular h-8 text-right"
                      {...register(`variants.${i}.weightG`)}
                    />
                  </TableCell>
                  <TableCell className="w-28 text-right">
                    {isNew ? (
                      <Input
                        aria-label={`Opening stock for variant ${i + 1}`}
                        inputMode="numeric"
                        className="tabular h-8 text-right"
                        title="Opening stock (written to the ledger on save)"
                        {...register(`variants.${i}.initialStock`)}
                      />
                    ) : (
                      <span
                        className="tabular inline-block pt-1.5"
                        title="Change stock in Inventory"
                      >
                        {v?.onHand ?? 0}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pt-3.5">
                    <Switch
                      aria-label={`Variant ${i + 1} active`}
                      checked={!!v?.active}
                      onCheckedChange={(on) =>
                        setValue(`variants.${i}.active`, on, { shouldDirty: true })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={v?.hasHistory ? "Deactivate variant" : "Remove variant"}
                      title={
                        v?.hasHistory
                          ? "This variant has stock or order history, so it is deactivated instead of deleted"
                          : "Remove variant"
                      }
                      disabled={fields.length === 1}
                      onClick={() => {
                        if (v?.hasHistory)
                          setValue(`variants.${i}.active`, false, { shouldDirty: true });
                        else remove(i);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className={cn("mt-3 flex flex-wrap gap-2 px-5 text-xs text-admin-ink-muted")}>
          <Badge>
            {fields.length} variant{fields.length === 1 ? "" : "s"}
          </Badge>
          <span>
            New variants take opening stock here; existing stock is read-only (Inventory adjusts
            it).
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function VariantsTab() {
  return (
    <div className="flex flex-col gap-5">
      <OptionsEditor />
      <VariantMatrix />
    </div>
  );
}
