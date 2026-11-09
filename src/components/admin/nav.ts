import type { Permission } from "@/server/auth/permissions";

export type NavIconKey =
  | "dashboard"
  | "products"
  | "collections"
  | "inventory"
  | "orders"
  | "discounts"
  | "content"
  | "faq"
  | "policies"
  | "customers"
  | "support"
  | "reports"
  | "insights"
  | "pincodes"
  | "settings"
  | "users"
  | "audit";

export interface NavItemDef {
  /** URL segment under /admin ("" = dashboard). */
  slug: string;
  label: string;
  icon: NavIconKey;
  /** Shown in the sidebar and the page is reachable only with this permission. */
  permission: Permission;
  /** False = module not built yet: renders the "coming soon" page. */
  built: boolean;
  blurb: string;
}

export interface NavGroupDef {
  label: string | null;
  items: NavItemDef[];
}

export const NAV: NavGroupDef[] = [
  {
    label: null,
    items: [
      {
        slug: "",
        label: "Dashboard",
        icon: "dashboard",
        permission: "dashboard:view",
        built: true,
        blurb: "",
      },
    ],
  },
  {
    label: "Catalogue",
    items: [
      {
        slug: "products",
        label: "Products",
        icon: "products",
        permission: "product:view",
        built: true,
        blurb: "",
      },
      {
        slug: "collections",
        label: "Collections",
        icon: "collections",
        permission: "collection:view",
        built: true,
        blurb: "Vibe and type copy, and the order of featured products per vibe.",
      },
      {
        slug: "inventory",
        label: "Inventory",
        icon: "inventory",
        permission: "inventory:view",
        built: true,
        blurb: "On-hand, reserved and available stock, adjustments with a reason, and CSV export and import.",
      },
    ],
  },
  {
    label: "Sales",
    items: [
      {
        slug: "orders",
        label: "Orders",
        icon: "orders",
        permission: "order:view",
        built: true,
        blurb: "Order list, fulfilment updates, tracking, packing slips and refunds.",
      },
      {
        slug: "customers",
        label: "Customers",
        icon: "customers",
        permission: "customer:view",
        built: true,
        blurb: "Customer accounts, order history and data export or deletion requests.",
      },
      {
        slug: "support",
        label: "Support",
        icon: "support",
        permission: "support:view",
        built: true,
        blurb: "Contact inbox and damaged, defective and missing-item cases.",
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        slug: "content",
        label: "Content",
        icon: "content",
        permission: "content:view",
        built: true,
        blurb: "Banners and homepage sets.",
      },
      {
        slug: "faq",
        label: "FAQ",
        icon: "faq",
        permission: "content:view",
        built: true,
        blurb: "Questions and answers shown on the storefront.",
      },
      {
        slug: "policies",
        label: "Policies",
        icon: "policies",
        permission: "policy:view",
        built: true,
        blurb: "Shipping, returns, privacy and terms, with version history.",
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      {
        slug: "reports",
        label: "Reports",
        icon: "reports",
        permission: "report:view",
        built: true,
        blurb: "Sales, GST and stock reports.",
      },
      {
        slug: "insights",
        label: "Insights",
        icon: "insights",
        permission: "insight:view",
        built: true,
        blurb: "Product engagement and conversion signals.",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        slug: "pincodes",
        label: "Pincodes",
        icon: "pincodes",
        permission: "setting:view",
        built: true,
        blurb: "Where we deliver and where cash on delivery is offered, by pincode, state or zone.",
      },
      {
        slug: "settings",
        label: "Settings",
        icon: "settings",
        permission: "setting:view",
        built: true,
        blurb: "Store settings, tax, shipping, COD and launch checklist.",
      },
      {
        slug: "users",
        label: "Users",
        icon: "users",
        permission: "user:list",
        built: true,
        blurb: "Staff accounts and roles.",
      },
      {
        slug: "audit",
        label: "Audit log",
        icon: "audit",
        permission: "audit:view",
        built: true,
        blurb: "Who changed what, and when.",
      },
    ],
  },
];

export const NAV_ITEMS: NavItemDef[] = NAV.flatMap((g) => g.items);

export function navItemBySlug(slug: string): NavItemDef | undefined {
  return NAV_ITEMS.find((i) => i.slug === slug);
}

export function hrefFor(item: NavItemDef): string {
  return item.slug ? `/admin/${item.slug}` : "/admin";
}
