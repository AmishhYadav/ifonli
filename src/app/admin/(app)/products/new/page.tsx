import type { Metadata } from "next";

import { ProductForm } from "@/components/admin/products/ProductForm";
import { emptyFormValues } from "@/components/admin/products/form-values";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getProductFormOptions } from "@/server/services/admin/products";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const session = await requireAdmin("product:create");
  const options = await getProductFormOptions(getDb());
  return (
    <ProductForm
      options={options}
      defaultValues={emptyFormValues(options)}
      productId={null}
      images={[]}
      siteHost={siteHost()}
      permissions={permissionsFor(session.user.role)}
    />
  );
}

function permissionsFor(role: string) {
  return {
    create: can(role, "product:create"),
    update: can(role, "product:update"),
    archive: can(role, "product:archive"),
  };
}

function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ifonli.in").host;
  } catch {
    return "ifonli.in";
  }
}
