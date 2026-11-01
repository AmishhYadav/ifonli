"use client";

import Link from "next/link";
import { useState } from "react";

import { IconButton } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { isVibe } from "@/features/vibe/config";
import { VibeLink } from "@/features/vibe/VibeLink";
import { cn } from "@/lib/cn";

export interface MenuLink {
  href: string;
  label: string;
  detail?: string;
  /** Wear this vibe's tokens (a mini swatch). */
  vibe?: string;
}

interface MobileMenuProps {
  vibes: MenuLink[];
  types: MenuLink[];
  className?: string;
}

const rowClasses =
  "flex min-h-12 items-center justify-between gap-3 rounded-2xl px-3 text-lg font-semibold text-ink transition-colors ease-vibe hover:bg-surface-2";

/** A vibe row also wears that vibe (same switch as the pills and the hand); other rows just navigate. */
function renderLink(link: MenuLink, onNavigate: () => void) {
  const className = cn(
    rowClasses,
    link.vibe && "rounded-card bg-surface-2 font-display text-xl",
    link.vibe && "my-1 min-h-14",
  );
  const body = (
    <>
      <span>{link.label}</span>
      {link.vibe ? (
        <span aria-hidden="true" className="flex gap-1">
          <span className="size-4 rounded-full bg-accent" />
          <span className="size-4 rounded-full bg-accent-2" />
          <span className="size-4 rounded-full bg-accent-3" />
        </span>
      ) : link.detail ? (
        <span className="text-sm font-normal text-ink-muted">{link.detail}</span>
      ) : (
        <Icon name="chevron-right" className="size-5 text-ink-muted" />
      )}
    </>
  );
  return isVibe(link.vibe) ? (
    <VibeLink vibe={link.vibe} href={link.href} data-vibe={link.vibe} onClick={onNavigate} className={className}>
      {body}
    </VibeLink>
  ) : (
    <Link href={link.href} onClick={onNavigate} className={className}>
      {body}
    </Link>
  );
}

function Group({ title, links, onNavigate }: { title: string; links: MenuLink[]; onNavigate: () => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="px-3 pb-1 text-xs font-bold tracking-widest text-ink-muted uppercase">{title}</h2>
      <ul className="flex flex-col">
        {links.map((link) => (
          <li key={link.href}>
            <DrawerClose asChild>
              {renderLink(link, onNavigate)}
            </DrawerClose>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Right-hand drawer with the full navigation (plus account and wishlist), for screens below `md`. */
export function MobileMenu({ vibes, types, className }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <IconButton icon="menu" label="Open menu" className={className} />
      </DrawerTrigger>
      <DrawerContent title="Menu" side="right">
        <nav aria-label="Mobile" className="flex flex-col gap-5">
          <ul className="flex flex-col">
            <li>
              <DrawerClose asChild>
                <Link href="/shop" onClick={close} className={rowClasses}>
                  Shop all
                  <Icon name="chevron-right" className="size-5 text-ink-muted" />
                </Link>
              </DrawerClose>
            </li>
          </ul>
          <Group title="Vibes" links={vibes} onNavigate={close} />
          <Group title="Types" links={types} onNavigate={close} />
          <Group
            title="You"
            onNavigate={close}
            links={[
              { href: "/account", label: "Account" },
              { href: "/wishlist", label: "Wishlist" },
              { href: "/track", label: "Track your order" },
              { href: "/help", label: "Help and contact" },
            ]}
          />
        </nav>
      </DrawerContent>
    </Drawer>
  );
}
