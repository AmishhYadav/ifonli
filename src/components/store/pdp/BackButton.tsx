"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { hasInAppPrevious } from "@/features/navigation/in-app-history";

/**
 * "Back" on a product page. When the visitor came from another page of the storefront in this tab it goes
 * back in history (so the listing returns with its filters and scroll position); otherwise it is a plain link
 * to the product's type listing. It is a real link, so the fallback also works without JS or in a new tab.
 */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      aria-label="Back to products"
      data-testid="pdp-back"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!hasInAppPrevious()) return;
        event.preventDefault();
        router.back();
      }}
      className="inline-flex min-h-11 flex-none items-center justify-center gap-2 rounded-full bg-surface-2 text-sm max-sm:min-w-11 sm:px-4 font-semibold text-ink transition-colors ease-vibe hover:bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface-2))] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <Icon name="arrow-left" className="size-4" />
      <span className="max-sm:sr-only">Back</span>
    </Link>
  );
}
