import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductForm } from "@/components/admin/products/ProductForm";
import { detailToFormValues } from "@/components/admin/products/form-values";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getAdminProduct, getProductFormOptions } from "@/server/services/admin/products";
import { resolveImageUrl } from "@/server/services/media";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Edit product" };

function safeUrl(path: string): string | null {
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ifonli.in").host;
  } catch {
    return "ifonli.in";
  }
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin("product:view");
  const { id } = await params;
  const db = getDb();
  const [detail, options] = await Promise.all([getAdminProduct(db, id), getProductFormOptions(db)]);
  if (!detail) notFound();

  const role = session.user.role;
  return (
    <ProductForm
      // Remount with fresh ids/values after every save (updated_at changes on each update).
      key={`${detail.id}:${detail.updatedAt.getTime()}`}
      options={options}
      defaultValues={detailToFormValues(detail)}
      productId={detail.id}
      images={detail.images.map((i) => ({
        id: i.id,
        kind: i.kind,
        path: i.path,
        alt: i.alt,
        width: i.width,
        height: i.height,
        isPlaceholder: i.isPlaceholder,
        url: safeUrl(i.path),
      }))}
      siteHost={siteHost()}
      permissions={{
        create: can(role, "product:create"),
        update: can(role, "product:update"),
        archive: can(role, "product:archive"),
      }}
      meta={{ status: detail.status, name: detail.name }}
    />
  );
}
