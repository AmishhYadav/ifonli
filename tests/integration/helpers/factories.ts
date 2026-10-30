import { getDb } from "@/server/db";
import { productTypes, products, variants } from "@/server/db/schema";

let counter = 0;
const next = () => ++counter;

export async function makeType() {
  const n = next();
  const [row] = await getDb()
    .insert(productTypes)
    .values({ slug: `type-${n}`, name: `Type ${n}` })
    .returning();
  return row!;
}

export async function makeProduct(overrides: Partial<typeof products.$inferInsert> = {}) {
  const type = await makeType();
  const n = next();
  const [row] = await getDb()
    .insert(products)
    .values({ slug: `product-${n}`, name: `Product ${n}`, typeId: type.id, ...overrides })
    .returning();
  return row!;
}

export async function makeVariant(
  productId: string,
  overrides: Partial<typeof variants.$inferInsert> = {},
) {
  const n = next();
  const [row] = await getDb()
    .insert(variants)
    .values({
      productId,
      sku: `SKU-${n}`,
      pricePaise: 10000,
      mrpPaise: 12000,
      stockOnHand: 5,
      ...overrides,
    })
    .returning();
  return row!;
}

/** Unwraps Drizzle's query error to the underlying Postgres error code (e.g. 23514 = check). */
export async function pgErrorCode(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    let e: unknown = error;
    while (e && typeof e === "object") {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
      e = (e as { cause?: unknown }).cause;
    }
    throw error;
  }
}

export const PG = {
  unique: "23505",
  check: "23514",
  foreignKey: "23503",
  notNull: "23502",
} as const;
