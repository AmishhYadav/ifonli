import type { Metadata } from "next";
import Link from "next/link";

import { LaunchPanel } from "@/components/admin/settings/LaunchPanel";
import { SettingCard, type SettingCardData } from "@/components/admin/settings/SettingCard";
import { nodeForSetting } from "@/components/admin/settings/field-model";
import { Badge, PageHeader, cn } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getLaunchReadiness } from "@/server/services/admin/launch";
import { listSettingsAdmin } from "@/server/services/admin/settings";
import { SETTINGS, SETTING_GROUPS, type SettingGroup } from "@/server/services/settings-registry";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Settings" };

const GROUP_LABELS: Record<SettingGroup, string> = {
  store: "Store and legal",
  pricing: "Pricing and tax",
  shipping: "Shipping",
  cod: "Cash on delivery",
  inventory: "Inventory",
  returns: "Cancellation and returns",
  accounts: "Accounts",
  vibes: "Vibes",
  notifications: "Notifications",
  analytics: "Analytics",
  policies: "Policy copy",
};

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("setting:view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.group) ? sp.group[0] : sp.group;
  const group = (SETTING_GROUPS as readonly string[]).includes(raw ?? "") ? (raw as SettingGroup) : null;

  const db = getDb();
  const [rows, readiness] = await Promise.all([listSettingsAdmin(db), getLaunchReadiness(db)]);
  const blockersByGroup = new Map<string, number>();
  for (const r of rows) if (r.blocksLaunch) blockersByGroup.set(r.group, (blockersByGroup.get(r.group) ?? 0) + 1);

  const cards: SettingCardData[] = rows
    .filter((r) => r.group === group)
    .map((r) => ({
      key: r.key,
      // Money is typed in rupees (stored as paise), so the registry's "(paise)" suffix would mislead.
      label: r.label.replace(/\s*\(paise\)/i, ""),
      description: r.description.replace(/\s*\(paise\)/i, ""),
      value: r.value,
      isPlaceholder: r.isPlaceholder,
      blocksLaunch: r.blocksLaunch,
      requiredForLaunch: r.requiredForLaunch,
      locked: r.locked,
      unused: "unused" in SETTINGS[r.key] && SETTINGS[r.key].unused === true,
      updated:
        r.updatedAt && r.updatedByName && !r.isPlaceholder
          ? `Last changed by ${r.updatedByName} on ${dateTime.format(r.updatedAt)}`
          : null,
      node: nodeForSetting(r.key),
    }));

  const canEdit = can(session.user.role, "setting:update");
  const navLink = "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-admin-surface-2";
  return (
    <>
      <PageHeader
        title="Settings"
        description="Business rules, store details and the launch checklist. Only the owner can change them; every change is recorded in the audit log."
      />
      {/* minmax(0,1fr) also below lg: an `auto` column grows to the nav pills' full width (about 1600px) and widens the whole page on phones. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            <li>
              <Link
                href="/admin/settings"
                aria-current={group === null ? "page" : undefined}
                className={cn(navLink, "whitespace-nowrap", group === null && "bg-admin-primary-soft font-medium text-admin-primary")}
              >
                Launch checklist
                <Badge tone={readiness.ready ? "success" : "danger"}>{readiness.ready ? "Ready" : readiness.blockers}</Badge>
              </Link>
            </li>
            {SETTING_GROUPS.map((g) => (
              <li key={g}>
                <Link
                  href={`/admin/settings?group=${g}`}
                  aria-current={group === g ? "page" : undefined}
                  className={cn(navLink, "whitespace-nowrap", group === g && "bg-admin-primary-soft font-medium text-admin-primary")}
                >
                  {GROUP_LABELS[g]}
                  {blockersByGroup.get(g) ? <Badge tone="danger">{blockersByGroup.get(g)}</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0" data-visual-mask>
          {group === null ? (
            <LaunchPanel readiness={readiness} />
          ) : (
            <div className="flex max-w-3xl flex-col gap-5">
              <h2 className="text-base font-semibold">{GROUP_LABELS[group]}</h2>
              {group === "shipping" ? (
                <p className="text-[13px] text-admin-ink-muted">
                  Which pincodes we deliver to, and where COD is offered, is managed per pincode under{" "}
                  <Link
                    href="/admin/pincodes"
                    className="font-medium text-admin-primary underline-offset-2 hover:underline"
                  >
                    Pincodes
                  </Link>
                  .
                </p>
              ) : null}
              {cards.map((c) => (
                <SettingCard
                  // Remount with fresh values after every save.
                  key={`${c.key}:${JSON.stringify(c.value)}:${c.isPlaceholder}`}
                  setting={c}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
