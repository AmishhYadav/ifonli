"use client";

import Link from "next/link";
import { useState } from "react";

import { IconButton } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
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
  "flex min-h-12 items-center justify-between gap-3 rounded-input px-3 text-lg font-semibold text-ink hover:bg-surface-2";

function Group({ title, links, onNavigate }: { title: string; links: MenuLink[]; onNavigate: () => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="px-3 pb-1 text-xs font-bold tracking-widest text-ink-muted uppercase">{title}</h2>
      <ul className="flex flex-col">
        {links.map((link) => (
          <li key={link.href}>
            <DrawerClose asChild>
              <Link
                href={link.href}
                data-vibe={link.vibe}
                onClick={onNavigate}
                className={cn(
                  rowClasses,
                  link.vibe && "rounded-card border-token bg-bg font-display text-xl hover:bg-bg",
                  link.vibe && "my-1 min-h-14",
                )}
              >
                <span>{link.label}</span>
                {link.vibe ? (
                  <span aria-hidden="true" className="flex gap-1">
                    <span className="size-4 rounded-full border border-border bg-accent" />
                    <span className="size-4 rounded-full border border-border bg-accent-2" />
                    <span className="size-4 rounded-full border border-border bg-accent-3" />
                  </span>
                ) : link.detail ? (
                  <span className="text-sm font-normal text-ink-muted">{link.detail}</span>
                ) : (
                  <Icon name="chevron-right" className="size-5 text-ink-muted" />
                )}
              </Link>
            </DrawerClose>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Right-hand drawer with the full navigation, for screens below `lg`. */
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
