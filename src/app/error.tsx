"use client";

import { ErrorView } from "@/components/store/ErrorView";

/** Last-resort boundary for routes outside the storefront group (it replaces the page, layouts above stay). */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main">
      <ErrorView {...props} />
    </main>
  );
}
