"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  TextAreaField,
  TextField,
} from "@/components/admin/ui";
import type { ProductFormValues } from "@/server/services/admin/product-schema";

export function LegalTab() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Legal Metrology</CardTitle>
          <CardDescription>
            Shown on the product page. Blank country of origin and manufacturer fall back to the
            store defaults in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TextField<ProductFormValues>
            name="countryOfOrigin"
            label="Country of origin"
            placeholder="Store default"
          />
          <TextField<ProductFormValues>
            name="netQuantity"
            label="Net quantity"
            placeholder="For example 1 N or 3 pieces"
          />
          <TextField<ProductFormValues>
            name="dimensions"
            label="Dimensions"
            placeholder="For example 3 cm × 2 cm"
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Manufacturer override</CardTitle>
            <CardDescription>
              Only fill in if this product has a different manufacturer, packer or importer.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <TextField<ProductFormValues>
              name="manufacturerName"
              label="Name"
              placeholder="Store default"
            />
            <TextAreaField<ProductFormValues> name="manufacturerAddress" label="Address" rows={3} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>GST</CardTitle>
            <CardDescription>Blank GST rate uses the store default.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField<ProductFormValues>
              name="hsnCode"
              label="HSN code"
              placeholder="Not set"
              className="font-mono"
            />
            <TextField<ProductFormValues>
              name="gstRatePercent"
              label="GST rate (%)"
              inputMode="decimal"
              placeholder="Store default"
              hint="For example 18 or 5"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
