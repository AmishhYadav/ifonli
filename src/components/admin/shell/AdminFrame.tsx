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
  ShieldCheck,
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
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className="flex flex-col gap-0.5">
          {group.label ? (
            <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-admin-nav-muted uppercase">
              {group.label}
            </p>
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
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] text-admin-nav-ink/90 transition-colors hover:bg-admin-nav-hover hover:text-admin-nav-ink",
                  active && "bg-admin-nav-active text-admin-nav-ink",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                <span className="flex-1 truncate">{item.label}</span>
                {item.built ? null : (
                  <span className="rounded bg-admin-nav-hover px-1.5 py-px text-[10px] text-admin-nav-muted">
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
    <Link href="/admin" className="flex items-center gap-2 px-2.5 text-admin-nav-ink">
      <span className="flex size-7 items-center justify-center rounded-md bg-admin-primary text-admin-on-primary">
        <ShieldCheck className="size-4" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">IfOnli</span>
      <span className="rounded bg-admin-nav-hover px-1.5 py-px text-[10px] tracking-wide text-admin-nav-muted uppercase">
        Admin
      </span>
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

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-admin-nav-border bg-admin-nav-bg px-3 py-4 lg:flex">
        <Brand />
        <NavList groups={groups} />
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 overflow-y-auto bg-admin-nav-bg px-3 py-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-admin-nav-muted hover:text-admin-nav-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <NavList groups={groups} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-admin-border bg-admin-surface/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label="Open menu"
            className="-ml-1.5 rounded-md p-1.5 text-admin-ink-muted hover:bg-admin-surface-2 lg:hidden"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-admin-surface-2"
              >
                {/* No aria-label: the accessible name is built from the visible text (WCAG 2.5.3), led by the purpose. */}
                <span className="sr-only">Account menu:</span>
                <span
                  aria-hidden
                  className="flex size-7 items-center justify-center rounded-full bg-admin-primary-soft text-xs font-semibold text-admin-primary"
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
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
