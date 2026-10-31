import type { Metadata } from "next";

/**
 * Everything under /account is per-customer, so it is never indexed and never cached, and it is
 * exempt from instant-navigation validation (a static shell would only ever be a spinner). The store
 * header and footer around it stay static: no cookie is read in the shared shell.
 */
export const instant = false;

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function AccountRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
