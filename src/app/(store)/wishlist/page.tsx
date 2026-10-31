import type { Metadata } from "next";
import Link from "next/link";

import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import { VibeCopy } from "@/components/store/VibeCopy";
import { WishlistView } from "@/features/wishlist/WishlistView";

export const metadata: Metadata = {
  title: "Your wishlist",
  description: "Products you saved on this device.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/wishlist" },
};

export default function WishlistPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 pb-4 sm:px-6">
      <Breadcrumbs
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Wishlist", path: "/wishlist" },
        ]}
      />
      <h1 className="mt-3 font-display text-4xl leading-tight display-fx sm:text-5xl">Your wishlist</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-muted">
        Saved on this device. Clearing your browser data clears this list, unless you{" "}
        <Link href="/account/login" className="text-link underline underline-offset-4 hover:no-underline">
          sign in
        </Link>{" "}
        and keep it with your account on every device.
      </p>
      <div className="mt-6">
        <WishlistView
          emptyTitle={<VibeCopy k="wishlist.emptyTitle" as="span" />}
          emptyBody="Tap the heart on anything you like and it will wait for you here."
        />
      </div>
    </div>
  );
}
