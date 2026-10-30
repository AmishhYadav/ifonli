import type { Metadata } from "next";
import Link from "next/link";

import { HandButton } from "@/features/vibe/HandButton";
import { VibeText } from "@/features/vibe/VibeText";

import { assertDevPagesEnabled } from "../../gate";

export const metadata: Metadata = {
  title: "Vibe playground: another page",
  robots: { index: false, follow: false },
};

/** Second page used by e2e to prove the vibe persists across (client) navigation. */
export default function OtherPage() {
  assertDevPagesEnabled();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <HandButton />
      <VibeText k="notFound.title" as="h1" className="font-display text-4xl" />
      <VibeText k="notFound.body" as="p" />
      <Link href="/dev/vibe" data-testid="back-link">
        Back to the playground
      </Link>
    </main>
  );
}
