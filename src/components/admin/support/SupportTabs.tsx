import Link from "next/link";

import { Badge, cn } from "@/components/admin/ui";

export type SupportTab = "inbox" | "cases";

/** Route-driven tabs (`?tab=`): plain links so the list stays shareable and works without client JS. */
export function SupportTabs({
  active,
  inboxOpen,
  casesOpen,
}: {
  active: SupportTab;
  inboxOpen: number;
  casesOpen: number;
}) {
  const items: { tab: SupportTab; label: string; count: number; href: string }[] = [
    { tab: "inbox", label: "Inbox", count: inboxOpen, href: "/admin/support" },
    { tab: "cases", label: "Cases", count: casesOpen, href: "/admin/support?tab=cases" },
  ];
  return (
    <nav
      aria-label="Support"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-admin-border"
    >
      {items.map((i) => (
        <Link
          key={i.tab}
          href={i.href}
          aria-current={i.tab === active ? "page" : undefined}
          className={cn(
            "relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
            i.tab === active
              ? "border-admin-primary text-admin-ink"
              : "border-transparent text-admin-ink-muted hover:text-admin-ink",
          )}
        >
          {i.label}
          <Badge tone={i.count > 0 ? "warning" : "neutral"}>
            {i.count}
            <span className="sr-only"> need attention</span>
          </Badge>
        </Link>
      ))}
    </nav>
  );
}
