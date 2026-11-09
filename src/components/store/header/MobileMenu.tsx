"use client";

import Link from "next/link";
import { useState } from "react";

import { IconButton } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { NAV_LINKS } from "./NavPills";

export interface MenuLink {
  href: string;
  label: string;
  detail?: string;
}

interface MobileMenuProps {
  className?: string;
}

const rowClasses =
  "flex min-h-12 items-center justify-between gap-3 rounded-2xl px-3 text-lg font-semibold text-ink transition-colors ease-vibe hover:bg-surface-2";

function renderLink(link: MenuLink, onNavigate: () => void) {
  return (
    <Link href={link.href} onClick={onNavigate} className={rowClasses}>
      <span>{link.label}</span>
      {link.detail ? (
        <span className="text-sm font-normal text-ink-muted">{link.detail}</span>
      ) : (
        <Icon name="chevron-right" className="size-5 text-ink-muted" />
      )}
    </Link>
  );
}

function Group({ title, links, onNavigate }: { title: string; links: MenuLink[]; onNavigate: () => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="px-3 pb-1 font-label text-xs tracking-widest text-ink-muted">{title}</h2>
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
export function MobileMenu({ className }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <IconButton icon="menu" label="Open menu" className={className} />
      </DrawerTrigger>
      <DrawerContent title="Menu" side="right">
        <nav aria-label="Mobile" className="flex flex-col gap-5">
          <Group
            title="Explore"
            onNavigate={close}
            links={[
              ...NAV_LINKS,
              { href: "/shop", label: "Shop all" },
            ]}
          />
          <Group
            title="You"
            onNavigate={close}
            links={[
              { href: "/account", label: "My Profile" },
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
