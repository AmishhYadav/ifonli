import type { Metadata } from "next";
import Link from "next/link";

import { VIBES, VIBE_NAMES } from "@/features/vibe/config";
import { COPY_KEYS } from "@/features/vibe/copy";
import { HandButton } from "@/features/vibe/HandButton";
import { VibeScope } from "@/features/vibe/VibeScope";
import { VibeText } from "@/features/vibe/VibeText";

import { assertDevPagesEnabled } from "../gate";

import { CurrentVibe } from "./CurrentVibe";
import { Sample } from "./Sample";
import { TokenTable } from "./TokenTable";

export const metadata: Metadata = {
  title: "Vibe playground",
  robots: { index: false, follow: false },
};

export default function VibePlaygroundPage() {
  assertDevPagesEnabled();

  return (
    <main className="mx-auto flex max-w-[1680px] flex-col gap-12 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-4">
        <HandButton />
        <div>
          <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">
            Vibe playground
          </h1>
          <CurrentVibe />
        </div>
      </header>

      <nav aria-label="Vibe links" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {VIBES.map((v) => (
          <a key={v} href={`?vibe=${v}`}>
            ?vibe={v}
          </a>
        ))}
        <a href="/dev/vibe/other">Another page</a>
        <Link href="/home">Home (client navigation)</Link>
      </nav>

      <section aria-labelledby="active" className="flex flex-col gap-4">
        <h2 id="active" className="font-display text-2xl">
          Active vibe
        </h2>
        <div className="rounded-card border-token bg-surface-2 p-4">
          <Sample title="This page" />
        </div>
        <TokenTable />
      </section>

      <section aria-labelledby="strip" className="flex flex-col gap-4">
        <h2 id="strip" className="font-display text-2xl">
          All four side by side (VibeScope)
        </h2>
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
          data-testid="vibe-strip"
        >
          {VIBES.map((v) => (
            <VibeScope key={v} vibe={v} className="overflow-hidden rounded-card">
              <Sample title={VIBE_NAMES[v]} />
            </VibeScope>
          ))}
        </div>
      </section>

      <section aria-labelledby="buy" className="flex flex-col gap-4">
        <h2 id="buy" className="font-display text-2xl">
          Buy scope (palette only; shape, type and texture reset to base)
        </h2>
        <div
          data-vibe-scope="buy"
          data-testid="buy-panel"
          className="max-w-xl rounded-md bg-bg text-ink"
        >
          <Sample title="Checkout" />
        </div>
      </section>

      <section aria-labelledby="copy" className="flex flex-col gap-4">
        <h2 id="copy" className="font-display text-2xl">
          VibeText copy
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {COPY_KEYS.map((k) => (
            <div key={k} className="rounded-card border-token bg-surface p-3">
              <dt className="text-xs text-ink-muted">{k}</dt>
              <dd>
                <VibeText k={k} className="text-base font-semibold" />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
