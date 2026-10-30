import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Admin RBAC permission matrix (plan section 11). Pure module: no server-only, no DB, so it can be
 * unit-tested and imported from the Better Auth config, `proxy.ts` and every Server Action.
 *
 * Roles
 *   owner       everything, including users and settings
 *   admin       everything except users, settings and policy publishing
 *   fulfilment  orders (view, fulfilment updates, tracking, packing slips) and support cases;
 *               NO catalogue, pricing, coupons, settings or reports
 *   customer    storefront account only; no admin permissions
 */

export const ROLES = ["owner", "admin", "fulfilment", "customer"] as const;
export type Role = (typeof ROLES)[number];
export const DEFAULT_ROLE: Role = "customer";
/** Roles that may enter /admin (and therefore must have TOTP 2FA). */
export const ADMIN_ROLES = ["owner", "admin", "fulfilment"] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAdminRole(value: unknown): value is (typeof ADMIN_ROLES)[number] {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/**
 * Statements: resource -> actions. `user` and `session` come from Better Auth's admin plugin
 * (its endpoints authorize against these exact names), the rest are IfOnli's.
 */
export const STATEMENTS = {
  ...defaultStatements,
  dashboard: ["view"],
  product: ["view", "create", "update", "archive"],
  collection: ["view", "update"],
  inventory: ["view", "adjust", "import"],
  order: [
    "view",
    "update_fulfilment",
    "add_shipment",
    "mark_cod_collected",
    "cancel",
    "refund",
    "resend_notification",
    "invoice",
    "packing_slip",
    "note",
  ],
  coupon: ["view", "manage"],
  content: ["view", "manage"],
  policy: ["view", "edit", "publish"],
  customer: ["view", "export", "delete"],
  support: ["view", "respond", "resolve"],
  report: ["view"],
  insight: ["view"],
  setting: ["view", "update"],
  audit: ["view"],
} as const;

export type Statements = typeof STATEMENTS;
export type Resource = keyof Statements;
export type Action<R extends Resource = Resource> = Statements[R][number];
/** `"resource:action"`, e.g. `"order:refund"`. */
export type Permission = {
  [R in Resource]: `${R}:${Statements[R][number]}`;
}[Resource];

type Grants = { readonly [R in Resource]?: readonly Action<R>[] };

const ALL: Grants = Object.fromEntries(
  Object.entries(STATEMENTS).map(([resource, actions]) => [resource, [...actions]]),
) as Grants;

/**
 * `admin` = everything except users/sessions, settings and policy publishing (plan section 11).
 * The settings module is hidden entirely (no `setting:view`).
 */
const ADMIN_GRANTS: Grants = {
  ...ALL,
  setting: undefined,
  user: [],
  session: [],
  policy: ["view", "edit"],
};

const FULFILMENT_GRANTS: Grants = {
  order: ["view", "update_fulfilment", "add_shipment", "invoice", "packing_slip", "note"],
  support: ["view", "respond"],
};

export const ROLE_PERMISSIONS: Readonly<Record<Role, Grants>> = {
  owner: ALL,
  admin: ADMIN_GRANTS,
  fulfilment: FULFILMENT_GRANTS,
  customer: {},
};

/** True if `role` holds `permission` (`"resource:action"`). Unknown roles hold nothing. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!isRole(role)) return false;
  const [resource, action] = permission.split(":") as [Resource, string];
  const actions = ROLE_PERMISSIONS[role][resource] as readonly string[] | undefined;
  return actions?.includes(action) ?? false;
}

/** Throws if the role lacks the permission. Use at the top of every admin Server Action. */
export function assertCan(role: string | null | undefined, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`Forbidden: role "${role ?? "none"}" lacks ${permission}`);
  }
}

// ---------------------------------------------------------------------------
// Better Auth access-control wiring (admin plugin). Built from the same matrix so the two never
// drift. The plugin enforces `user`/`session` statements on its own endpoints; the rest of the
// resources are enforced by our `can()` helper.
// ---------------------------------------------------------------------------
export const ac = createAccessControl(STATEMENTS);

type MutableGrants = Record<string, string[]>;
function toStatements(grants: Grants): MutableGrants {
  const out: MutableGrants = {};
  for (const [resource, actions] of Object.entries(grants)) {
    if (!actions) continue;
    out[resource] = [...(actions as readonly string[])];
  }
  return out;
}

export const authRoles = {
  owner: ac.newRole(toStatements(ROLE_PERMISSIONS.owner) as never),
  admin: ac.newRole(toStatements(ROLE_PERMISSIONS.admin) as never),
  fulfilment: ac.newRole(toStatements(ROLE_PERMISSIONS.fulfilment) as never),
  customer: ac.newRole(toStatements(ROLE_PERMISSIONS.customer) as never),
};
