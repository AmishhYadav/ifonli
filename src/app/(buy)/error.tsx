"use client";

import { ErrorView } from "@/components/store/ErrorView";

/**
 * Cart, checkout, orders and tracking boundary: the buy header, skip link and policy footer from the layout
 * stay around it (without this file a crash falls through to the bare root boundary, which has none of them).
 */
export default function BuyError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
