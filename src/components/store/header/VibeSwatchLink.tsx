import Link from "next/link";

/**
 * A menu item that wears one vibe's tokens (palette, radius, border, display font, texture) whatever the
 * site vibe is: its name in the vibe's own font next to the vibe's three accent colours.
 */
export function VibeSwatchLink({ href, vibe, label }: { href: string; vibe: string; label: string }) {
  return (
    <Link
      href={href}
      data-vibe={vibe}
      className="flex min-h-14 items-center justify-between gap-3 rounded-card border-token bg-bg px-3.5 py-2 font-display text-xl leading-tight text-ink shadow-button transition-transform ease-vibe hover:-translate-y-0.5"
    >
      {label}
      <span aria-hidden="true" className="flex gap-1">
        <span className="size-4 rounded-full border border-border bg-accent" />
        <span className="size-4 rounded-full border border-border bg-accent-2" />
        <span className="size-4 rounded-full border border-border bg-accent-3" />
      </span>
    </Link>
  );
}
