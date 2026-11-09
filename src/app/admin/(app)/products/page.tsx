import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ProductsTable, type ProductRowView } from "@/components/admin/products/ProductsTable";
import { Button, PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  getProductFormOptions,
  listAdminProducts,
  type StockState,
} from "@/server/services/admin/products";
import type { ProductStatus } from "@/server/services/admin/product-schema";
import { resolveImageUrl } from "@/server/services/media";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Products" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function safeImageUrl(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("product:view");
  const sp = await searchParams;
  const db = getDb();
  const status = ["draft", "active", "archived"].includes(one(sp.status) ?? "")
    ? (one(sp.status) as ProductStatus)
    : undefined;
  const stock = ["in", "low", "out"].includes(one(sp.stock) ?? "")
    ? (one(sp.stock) as StockState)
    : undefined;
  const filters = { vibe: one(sp.collection), type: one(sp.type), status, stock };

  const [list, options] = await Promise.all([
    listAdminProducts(db, { ...filters, pageSize: 5000 }),
    getProductFormOptions(db),
  ]);
  const rows: ProductRowView[] = list.items.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    typeName: p.typeName,
    isKit: p.isKit,
    vibeNames: p.vibeNames,
    variantCount: p.variantCount,
    priceFromPaise: p.priceFromPaise,
    priceToPaise: p.priceToPaise,
    available: p.available,
    stock: p.stock,
    imageUrl: safeImageUrl(p.image?.path),
    imageAlt: p.image?.alt ?? "",
    updatedAt: p.updatedAt.toISOString(),
  }));
  const canCreate = can(session.user.role, "product:create");

  return (
    <>
      <PageHeader
        title="Products"
        description="Charms, 3D stickers and DIY kits."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/admin/products/new">
                <Plus aria-hidden /> New product
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ProductsTable rows={rows} filters={filters} options={options} canCreate={canCreate} />
    </>
  );
}
