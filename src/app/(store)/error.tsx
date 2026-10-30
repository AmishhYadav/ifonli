"use client";

import { ErrorView } from "@/components/store/ErrorView";

/** Storefront boundary: the header and footer from the layout stay put around it. */
export default function StoreError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
