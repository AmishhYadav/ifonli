"use client";

import {
  BarChart3,
  ClipboardList,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  MapPin,
  Menu,
  Package,
  ScrollText,
  Settings,
  Sparkles,
  Ticket,
  UserCog,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { signOutAction } from "@/app/admin/(auth)/actions";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/components/admin/ui";

import type { NavIconKey } from "../nav";
import { BrandMark } from "./BrandMark";

const ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  products: Package,
  collections: LayoutGrid,
  inventory: Warehouse,
  orders: ClipboardList,
  discounts: Ticket,
  content: FileText,
  faq: HelpCircle,
  policies: ScrollText,
  customers: Users,
  support: LifeBuoy,
  reports: BarChart3,
  insights: Sparkles,
  pincodes: MapPin,
  settings: Settings,
  users: UserCog,
  audit: History,
};

export interface FrameNavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  built: boolean;
}
export interface FrameNavGroup {
  label: string | null;
  items: FrameNavItem[];
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  fulfilment: "Fulfilment",
};

function isActive(pathname: string, href: string): boolean {
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ groups, onNavigate }: { groups: FrameNavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const navRef = React.useRef<HTMLElement>(null);
  const pillRef = React.useRef<HTMLSpanElement>(null);

  // The pill is a single transform-only element that glides to the active link. Every row has the
  // same height, so its position is just the active link's offsetTop.
  React.useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!active || active.offsetHeight === 0) {
        pill.removeAttribute("data-ready");
        return;
      }
      pill.style.setProperty("--pill-y", `${active.offsetTop}px`);
      if (pill.dataset.ready !== "true") {
        // First placement is instant; only later route changes glide.
        requestAnimationFrame(() => pill.setAttribute("data-ready", "true"));
      }
    };
    place();
    const sizes = new ResizeObserver(place);
    sizes.observe(nav);
    return () => sizes.disconnect();
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label="Admin" className="relative flex flex-col gap-5">
      <span ref={pillRef} aria-hidden className="admin-nav-pill" />
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className="flex flex-col gap-0.5">
          {group.label ? (
            <p className="px-3 pb-1 text-xs font-semibold text-admin-ink-faint">{group.label}</p>
          ) : null}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative z-[1] flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13.5px] font-medium text-admin-ink-muted transition-colors duration-200 active:scale-[0.98]",
                  active ? "text-admin-primary" : "hover:bg-admin-surface-2 hover:text-admin-ink",
                )}
              >
                <Icon
                  className="size-4 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110 group-hover:-rotate-6"
                  aria-hidden
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.built ? null : (
                  <span className="rounded-full bg-admin-surface-2 px-1.5 py-px text-[10px] text-admin-ink-muted">
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="rounded-xl px-2 py-1">
      <BrandMark size="sm" />
    </Link>
  );
}

export function AdminFrame({
  groups,
  user,
  children,
}: {
  groups: FrameNavGroup[];
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const signOutForm = React.useRef<HTMLFormElement>(null);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="admin-glass sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto overscroll-contain border-r border-admin-border px-3 py-4 lg:flex">
        <Brand />
        <NavList groups={groups} />
      </aside>

      {/* Mobile drawer: always mounted so it can slide out as well as in; `inert` + `invisible` when closed. */}
      <div
        inert={!open}
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          open ? "visible" : "invisible transition-[visibility] delay-[350ms] duration-0",
        )}
      >
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={open ? 0 : -1}
          className={cn(
            "absolute inset-0 bg-admin-scrim backdrop-blur-[2px] transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(false)}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex w-72 flex-col gap-6 overflow-y-auto overscroll-contain border-r border-admin-border bg-admin-surface px-3 py-4 shadow-xl transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between">
            <Brand />
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-admin-ink-muted transition-colors hover:bg-admin-primary-soft hover:text-admin-primary active:scale-90"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <NavList groups={groups} onNavigate={() => setOpen(false)} />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="admin-glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-admin-border px-4 sm:px-6">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-[image:var(--admin-grad)] opacity-60"
          />
          <button
            type="button"
            aria-label="Open menu"
            className="-ml-1.5 rounded-lg p-2 text-admin-ink-muted transition-colors hover:bg-admin-primary-soft hover:text-admin-primary active:scale-90 lg:hidden"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group flex items-center gap-2 rounded-full border border-transparent py-1 pr-3 pl-1 transition-colors hover:border-admin-border hover:bg-admin-surface active:scale-[0.97]"
              >
                {/* No aria-label: the accessible name is built from the visible text (WCAG 2.5.3), led by the purpose. */}
                <span className="sr-only">Account menu:</span>
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full bg-[image:var(--admin-grad)] font-admin-display text-[13px] font-bold text-admin-ink shadow-xs ring-2 ring-admin-surface transition-transform duration-300 group-hover:rotate-6"
                >
                  {initial}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-[13px] font-medium">{user.name}</span>
                  <span className="block text-[11px] text-admin-ink-muted">
                    {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>
                <span className="block text-sm font-medium text-admin-ink">{user.name}</span>
                <span className="block">{user.email}</span>
                <Badge tone="primary" className="mt-1.5">
                  {ROLE_LABEL[user.role] ?? user.role}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* The form lives outside the menu: closing the menu unmounts its content before a submit button inside it could fire. */}
              <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>
                <LogOut aria-hidden /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <form ref={signOutForm} action={signOutAction} hidden />
        <main className="admin-stagger mx-auto w-full max-w-[1280px] flex-1 px-4 py-7 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
