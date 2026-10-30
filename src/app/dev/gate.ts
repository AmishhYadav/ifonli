import { notFound } from "next/navigation";

/**
 * Dev-only pages: available outside production, or in a production build made with
 * NEXT_PUBLIC_ENABLE_DEV_PAGES=1 (used by the e2e suite, which runs against `next start`).
 */
export function assertDevPagesEnabled(): void {
  const enabled =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
  if (!enabled) notFound();
}
