import { z } from "zod";

/**
 * Pure settings registry (plan section 14): one definition per business-rule key, with a Zod
 * schema, a clearly fake placeholder, and a launch gate flag. No DB or server-only imports so it
 * can be unit-tested and reused by admin forms.
 *
 * Conventions
 *  - Money values are integer paise; durations carry their unit in the key or description.
 *  - Every owner-supplied value ships with a placeholder and is stored with `isPlaceholder: true`.
 *    Placeholder strings start with "PLACEHOLDER" so they are obvious in any UI or email.
 *  - Placeholders always satisfy their own schema, so reads never fail on a fresh database.
 *  - `locked` settings cannot be changed (legal / product decisions); `confirmed` ones are seeded
 *    with `isPlaceholder: false` because the owner already decided them.
 */

export const SETTING_GROUPS = [
  "store",
  "pricing",
  "shipping",
  "cod",
  "inventory",
  "returns",
  "accounts",
  "vibes",
  "notifications",
  "analytics",
  "policies",
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  schema: S;
  /** Obviously-fake starting value, valid under `schema`. */
  placeholder: z.input<S>;
  /** Production refuses orders while a required setting is still a placeholder. */
  requiredForLaunch: boolean;
  /** Not editable (decided and fixed). */
  locked?: true;
  /**
   * Nothing in this version reads the value (kept for a later release). Always set together with `locked`;
   * the admin UI says "Not used in this version" instead of offering an editor that would do nothing.
   */
  unused?: true;
  /** Owner already decided the value: seeded as non-placeholder. */
  confirmed?: true;
  /**
   * How the policy/FAQ template renderer prints the value: `money` (paise -> rupees), `md` (inserted as
   * Markdown source, not escaped) or `fulfillment_statuses` (array mapped to customer-facing labels).
   */
  format?: SettingFormat;
  /** Required for launch unless another setting has this value (e.g. returns copy when there are no returns). */
  requiredUnless?: { key: string; equals: unknown };
}

export type SettingFormat = "money" | "md" | "fulfillment_statuses";

function define<S extends z.ZodType>(
  key: string,
  def: Omit<SettingDefinition<S>, "key">,
): SettingDefinition<S> & { key: string } {
  return { key, ...def };
}

const PH = "PLACEHOLDER";
const nonEmpty = z.string().trim().min(1);
const paise = z.number().int().nonnegative();
const PLACEHOLDER_EMAIL = "placeholder@example.invalid";

// Shipping zones come from data/reference/zones.json.
export const SHIPPING_ZONES = [
  "metro_region",
  "rest_of_india",
  "north_east",
  "jk_ladakh",
  "islands",
] as const;
const zoneSchema = z.enum(SHIPPING_ZONES);

export const FULFILLMENT_STATUSES = [
  "unfulfilled",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "rto",
  "returned",
] as const;

export const NOTIFICATION_EVENTS = [
  "order_confirmed",
  "cod_order_placed",
  "payment_failed",
  "shipped",
  "delivered",
  "cancelled",
  "refund_initiated",
  "refund_processed",
  "support_case_update",
  "contact_ack",
] as const;

const channelFlags = z.object({ email: z.boolean(), whatsapp: z.boolean() });
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const SETTINGS = {
  // ---------------------------------------------------------------- Store / legal
  legal_name: define("legal_name", {
    group: "store",
    label: "Legal entity name",
    description: "Registered legal name shown in the footer, invoices and policy pages.",
    schema: nonEmpty,
    placeholder: `${PH} — Legal entity name`,
    requiredForLaunch: true,
  }),
  brand_name: define("brand_name", {
    group: "store",
    label: "Brand name",
    description: "Customer-facing brand name.",
    schema: nonEmpty,
    placeholder: "IfOnli",
    requiredForLaunch: false,
  }),
  registered_address: define("registered_address", {
    group: "store",
    label: "Registered address",
    description: "Registered office address (E-Commerce Rules 2020).",
    schema: nonEmpty,
    placeholder: `${PH} — Registered address`,
    requiredForLaunch: true,
  }),
  state: define("state", {
    group: "store",
    label: "Business state (place of supply)",
    description:
      "Indian state/UT name of the seller; decides CGST+SGST versus IGST. Must match a name in `states`.",
    schema: nonEmpty,
    placeholder: `${PH} — State`,
    requiredForLaunch: true,
  }),
  gstin: define("gstin", {
    group: "store",
    label: "GSTIN",
    description: "Leave empty if not GST-registered; invoices become 'Bill of supply'.",
    schema: z
      .string()
      .trim()
      .toUpperCase()
      .regex(GSTIN, "Not a valid 15-character GSTIN")
      .nullable(),
    placeholder: null,
    requiredForLaunch: false,
  }),
  support_email: define("support_email", {
    group: "store",
    label: "Customer-care email",
    description: "Shown on every page footer and in emails.",
    schema: z.email(),
    placeholder: PLACEHOLDER_EMAIL,
    requiredForLaunch: true,
  }),
  support_phone: define("support_phone", {
    group: "store",
    label: "Customer-care phone",
    description: "Customer-care phone number (E-Commerce Rules 2020).",
    schema: nonEmpty,
    placeholder: `${PH} — Phone number`,
    requiredForLaunch: true,
  }),
  support_hours: define("support_hours", {
    group: "store",
    label: "Support hours",
    description: "e.g. 'Mon–Sat, 10:00–18:00 IST'.",
    schema: nonEmpty,
    placeholder: `${PH} — Support hours`,
    requiredForLaunch: true,
  }),
  response_time: define("response_time", {
    group: "store",
    label: "Response time promise",
    description: "Shown on the Help page, e.g. 'within 24 hours'.",
    schema: nonEmpty,
    placeholder: `${PH} — Response time`,
    requiredForLaunch: true,
  }),
  default_manufacturer: define("default_manufacturer", {
    group: "store",
    label: "Default manufacturer / packer / importer",
    description: "Legal Metrology default; products may override.",
    schema: z.object({ name: nonEmpty, address: nonEmpty }),
    placeholder: { name: `${PH} — Manufacturer name`, address: `${PH} — Manufacturer address` },
    requiredForLaunch: true,
  }),
  default_country_of_origin: define("default_country_of_origin", {
    group: "store",
    label: "Default country of origin",
    description: "Used when a product does not set its own.",
    schema: nonEmpty,
    placeholder: `${PH} — Country of origin`,
    requiredForLaunch: true,
  }),

  // ---------------------------------------------------------------- Pricing / tax
  prices_include_gst: define("prices_include_gst", {
    group: "pricing",
    label: "Prices include GST",
    description: "Locked true: B2C prices must be shown inclusive of all taxes (Legal Metrology).",
    schema: z.literal(true),
    placeholder: true,
    requiredForLaunch: false,
    locked: true,
    confirmed: true,
  }),
  default_gst_rate_bp: define("default_gst_rate_bp", {
    group: "pricing",
    label: "Default GST rate (basis points)",
    description: "Used when a product has no rate. 1800 = 18%. Set by the owner's CA.",
    schema: z.number().int().min(0).max(10000),
    placeholder: 0,
    requiredForLaunch: true,
  }),
  shipping_tax_rule: define("shipping_tax_rule", {
    group: "pricing",
    label: "Shipping / COD fee tax rule",
    description: "How GST on shipping and COD fees is computed. CA to confirm.",
    schema: z.enum(["dominant_line_rate", "exempt", "default_rate"]),
    placeholder: "dominant_line_rate",
    requiredForLaunch: true,
  }),

  // ---------------------------------------------------------------- Shipping
  serviceability_mode: define("serviceability_mode", {
    group: "shipping",
    label: "Serviceability mode",
    description:
      "Not used in this version. There is one list: a pincode marked not serviceable is refused at checkout, whatever this says. Manage it under Pincodes (to serve only some areas, mark the rest not serviceable, in bulk by state).",
    schema: z.enum(["all_india", "allowlist", "denylist"]),
    placeholder: "all_india",
    requiredForLaunch: false,
    confirmed: true,
    locked: true,
    unused: true,
  }),
  flat_fee: define("flat_fee", {
    group: "shipping",
    format: "money",
    label: "Flat shipping fee (paise)",
    description: "Charged when the discounted subtotal is below the free-shipping threshold.",
    schema: paise,
    placeholder: 0,
    requiredForLaunch: true,
  }),
  free_threshold: define("free_threshold", {
    group: "shipping",
    format: "money",
    label: "Free-shipping threshold (paise)",
    description: "Discounted subtotal at or above which shipping is free. 0 = always free.",
    schema: paise,
    placeholder: 0,
    requiredForLaunch: true,
  }),
  free_shipping_pincodes: define("free_shipping_pincodes", {
    group: "shipping",
    label: "Free-shipping pincodes",
    description:
      "Delivery pincodes (6 digits, one per line) that always get free shipping, whatever the order value.",
    schema: z.array(z.string().regex(/^\d{6}$/)),
    placeholder: ["560064"],
    requiredForLaunch: false,
  }),
  zone_overrides: define("zone_overrides", {
    group: "shipping",
    label: "Per-zone shipping fee overrides (paise)",
    description: "Optional fee per shipping zone, replacing the flat fee.",
    schema: z.partialRecord(zoneSchema, paise),
    placeholder: {},
    requiredForLaunch: false,
  }),
  processing_days: define("processing_days", {
    group: "shipping",
    label: "Processing time (days)",
    description: "Days from order to dispatch.",
    schema: z.number().int().min(0).max(60),
    placeholder: 0,
    requiredForLaunch: true,
  }),
  delivery_estimates_by_zone: define("delivery_estimates_by_zone", {
    group: "shipping",
    label: "Delivery estimates by zone (days)",
    description: "Transit-time range per zone, shown on the PDP and in checkout.",
    schema: z.partialRecord(
      zoneSchema,
      z
        .object({ minDays: z.number().int().min(0), maxDays: z.number().int().min(0) })
        .refine((v) => v.maxDays >= v.minDays, {
          message: "maxDays must be >= minDays",
        }),
    ),
    placeholder: {},
    requiredForLaunch: true,
  }),
  delay_message: define("delay_message", {
    group: "shipping",
    label: "Delay banner message",
    description: "Optional notice shown on product and cart pages during delays. Empty = hidden.",
    schema: z.string().trim(),
    placeholder: "",
    requiredForLaunch: false,
  }),

  // ---------------------------------------------------------------- COD
  cod_enabled: define("cod_enabled", {
    group: "cod",
    label: "Cash on delivery enabled",
    description: "Master COD switch.",
    schema: z.boolean(),
    placeholder: false,
    requiredForLaunch: true,
  }),
  cod_fee: define("cod_fee", {
    group: "cod",
    format: "money",
    label: "COD fee (paise)",
    description: "Added to COD orders as its own line. 0 = no fee.",
    schema: paise,
    placeholder: 0,
    requiredForLaunch: true,
  }),
  cod_max_order_value: define("cod_max_order_value", {
    group: "cod",
    format: "money",
    label: "COD maximum order value (paise)",
    description: "Orders above this cannot use COD. 0 = no COD.",
    schema: paise,
    placeholder: 0,
    requiredForLaunch: true,
  }),
  cod_excluded_pincodes: define("cod_excluded_pincodes", {
    group: "cod",
    label: "COD-excluded pincodes",
    description: "Pincodes where COD is never offered, on top of the per-pincode flag.",
    schema: z.array(z.string().regex(/^\d{6}$/)),
    placeholder: [],
    requiredForLaunch: false,
  }),

  // ---------------------------------------------------------------- Inventory
  reservation_ttl_minutes: define("reservation_ttl_minutes", {
    group: "inventory",
    label: "Stock reservation window (minutes)",
    description: "How long prepaid checkout holds stock while payment is pending.",
    schema: z.number().int().min(1).max(1440),
    placeholder: 15,
    requiredForLaunch: true,
  }),
  backorders: define("backorders", {
    group: "inventory",
    label: "Allow backorders",
    description: "Locked false: sold-out items cannot be bought (FR-06).",
    schema: z.literal(false),
    placeholder: false,
    requiredForLaunch: false,
    locked: true,
    confirmed: true,
  }),
  default_low_stock_threshold: define("default_low_stock_threshold", {
    group: "inventory",
    label: "Default low-stock threshold",
    description:
      "Variants without their own threshold use this. Low-stock badges only show from real stock.",
    schema: z.number().int().min(0),
    placeholder: 5,
    requiredForLaunch: true,
  }),
  max_qty_per_line: define("max_qty_per_line", {
    group: "inventory",
    label: "Max quantity per cart line",
    description: "Hard cap on a single line's quantity.",
    schema: z.number().int().min(1).max(999),
    placeholder: 10,
    requiredForLaunch: true,
  }),

  // ---------------------------------------------------------------- Cancellation / returns
  cancellable_statuses: define("cancellable_statuses", {
    group: "returns",
    format: "fulfillment_statuses",
    label: "Cancellable fulfilment statuses",
    description: "Customers may cancel while the order's fulfilment status is one of these.",
    schema: z.array(z.enum(FULFILLMENT_STATUSES)),
    placeholder: ["unfulfilled"],
    requiredForLaunch: true,
  }),
  return_policy_type: define("return_policy_type", {
    group: "returns",
    label: "Return policy type",
    description:
      "no_returns or returns_window. Statutory rights for damaged/wrong goods always apply.",
    schema: z.enum(["no_returns", "returns_window"]),
    placeholder: "no_returns",
    requiredForLaunch: true,
  }),
  returns_window_days: define("returns_window_days", {
    group: "returns",
    label: "Returns window (days)",
    description: "Only used when the policy type is returns_window.",
    schema: z.number().int().min(0).max(365),
    placeholder: 0,
    requiredForLaunch: true,
  }),
  damaged_claim_window_hours: define("damaged_claim_window_hours", {
    group: "returns",
    label: "Damaged-goods claim window (hours)",
    description: "How long after delivery a customer can report a damaged/defective/wrong item.",
    schema: z
      .number()
      .int()
      .min(0)
      .max(24 * 365),
    placeholder: 0,
    requiredForLaunch: true,
  }),

  // ---------------------------------------------------------------- Accounts
  guest_checkout_enabled: define("guest_checkout_enabled", {
    group: "accounts",
    label: "Guest checkout enabled",
    description:
      "Not used in this version. Guests can always check out without an account (owner decision); this switch is not read anywhere.",
    schema: z.boolean(),
    placeholder: true,
    requiredForLaunch: false,
    confirmed: true,
    locked: true,
    unused: true,
  }),
  login_methods: define("login_methods", {
    group: "accounts",
    label: "Customer login methods",
    description:
      "Not used in this version. Customers always sign in with a passwordless email code; this list is not read anywhere.",
    schema: z.array(z.enum(["email_otp"])).min(1),
    placeholder: ["email_otp"],
    requiredForLaunch: false,
    locked: true,
    unused: true,
  }),

  // ---------------------------------------------------------------- Vibes
  vibe_cycle: define("vibe_cycle", {
    group: "vibes",
    label: "Hand-button vibe order",
    description: "Ordered list of vibe slugs the hand button cycles through. Wraps at the end.",
    schema: z.array(nonEmpty).min(1),
    placeholder: ["cute", "gothic", "funky", "bold"],
    requiredForLaunch: true,
  }),
  default_vibe: define("default_vibe", {
    group: "vibes",
    label: "Default vibe",
    description: "A vibe slug, or 'random'.",
    schema: nonEmpty,
    placeholder: "cute",
    requiredForLaunch: true,
  }),
  hero_enabled: define("hero_enabled", {
    group: "vibes",
    label: "Animated hero enabled",
    description: "When off, only the static poster hero is shown and the animated hero is never loaded.",
    schema: z.boolean(),
    placeholder: true,
    requiredForLaunch: false,
  }),
  custom_cursor_enabled: define("custom_cursor_enabled", {
    group: "vibes",
    label: "Custom cursors enabled",
    description:
      "Not used in this version. Custom cursors are not built yet, so this switch does nothing.",
    schema: z.boolean(),
    placeholder: false,
    requiredForLaunch: false,
    locked: true,
    unused: true,
  }),

  // ---------------------------------------------------------------- Notifications
  notification_channels: define("notification_channels", {
    group: "notifications",
    label: "Notification channels per event",
    description: "Which channel(s) each customer event uses. Email is required at launch.",
    schema: z.object(
      Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, channelFlags])) as Record<
        (typeof NOTIFICATION_EVENTS)[number],
        typeof channelFlags
      >,
    ),
    placeholder: Object.fromEntries(
      NOTIFICATION_EVENTS.map((e) => [e, { email: true, whatsapp: false }]),
    ) as Record<(typeof NOTIFICATION_EVENTS)[number], { email: boolean; whatsapp: boolean }>,
    requiredForLaunch: false,
  }),
  admin_alert_emails: define("admin_alert_emails", {
    group: "notifications",
    label: "Admin alert emails",
    description: "Recipients of new-order, low-stock and payment-anomaly alerts.",
    schema: z.array(z.email()).min(1),
    placeholder: [PLACEHOLDER_EMAIL],
    requiredForLaunch: true,
  }),

  // ---------------------------------------------------------------- Analytics
  ga4_measurement_id: define("ga4_measurement_id", {
    group: "analytics",
    label: "GA4 measurement ID",
    description: "Optional. Loads only after consent.",
    schema: z
      .string()
      .trim()
      .regex(/^G-[A-Z0-9]+$/)
      .nullable(),
    placeholder: null,
    requiredForLaunch: false,
  }),
  consent_required: define("consent_required", {
    group: "analytics",
    label: "Analytics consent banner",
    description: "Show the consent banner before loading GA4.",
    schema: z.boolean(),
    placeholder: true,
    requiredForLaunch: false,
  }),
  event_retention_months: define("event_retention_months", {
    group: "analytics",
    label: "Raw event retention (months)",
    description: "Raw analytics events are deleted after this long.",
    schema: z.number().int().min(1).max(60),
    placeholder: 13,
    requiredForLaunch: false,
  }),
  // ---------------------------------------------------------------- Policy copy (content/README.md)
  // Keys are dotted (`policy.*`) so the template token is `settings.policy.<name>`. Text values are
  // owner/lawyer-owned; `md` values are inserted into the policy Markdown as source.
  "policy.jurisdiction_city": define("policy.jurisdiction_city", {
    group: "policies",
    label: "Jurisdiction city",
    description: "City whose courts have jurisdiction over disputes (Terms and Conditions).",
    schema: nonEmpty,
    placeholder: `${PH} — Jurisdiction city`,
    requiredForLaunch: true,
  }),
  "policy.processors": define("policy.processors", {
    group: "policies",
    label: "Service providers (Markdown)",
    description:
      "Privacy notice: the actual payment, courier, email/WhatsApp, hosting and analytics providers. Markdown list.",
    schema: nonEmpty,
    placeholder: `${PH} — Service providers`,
    requiredForLaunch: true,
    format: "md",
  }),
  "policy.materials_note": define("policy.materials_note", {
    group: "policies",
    label: "Materials note (Markdown)",
    description: "FAQ: generic statement about materials used.",
    schema: nonEmpty,
    placeholder: `${PH} — Materials note`,
    requiredForLaunch: true,
    format: "md",
  }),
  "policy.handmade_note": define("policy.handmade_note", {
    group: "policies",
    label: "Handmade / variation notice",
    description: "Optional. Terms and Conditions: shown only when filled in. Empty = hidden.",
    schema: z.string().trim(),
    placeholder: "",
    requiredForLaunch: false,
  }),
  "policy.working_days": define("policy.working_days", {
    group: "policies",
    label: "Working days",
    description: "Shipping policy: which days count as working days, e.g. 'Monday to Saturday'.",
    schema: nonEmpty,
    placeholder: `${PH} — Working days`,
    requiredForLaunch: true,
  }),
  "policy.courier_partners": define("policy.courier_partners", {
    group: "policies",
    label: "Courier partner(s)",
    description: "Shipping policy: courier partner name(s).",
    schema: nonEmpty,
    placeholder: `${PH} — Courier partners`,
    requiredForLaunch: true,
  }),
  "policy.delivery_attempts": define("policy.delivery_attempts", {
    group: "policies",
    label: "Delivery attempts before RTO",
    description: "Shipping policy and FAQ: how many delivery attempts before the parcel is returned.",
    schema: z.number().int().min(1).max(10),
    placeholder: 1,
    requiredForLaunch: true,
  }),
  "policy.rto_handling": define("policy.rto_handling", {
    group: "policies",
    label: "After return-to-origin (Markdown)",
    description: "Shipping policy: what happens after an RTO (reship, refund, fees).",
    schema: nonEmpty,
    placeholder: `${PH} — RTO handling`,
    requiredForLaunch: true,
    format: "md",
  }),
  "policy.refund_initiation_days": define("policy.refund_initiation_days", {
    group: "policies",
    label: "Refund initiation (working days)",
    description: "Working days we take to start a refund after approval or cancellation.",
    schema: z.number().int().min(0).max(60),
    placeholder: 0,
    requiredForLaunch: true,
  }),
  "policy.refund_bank_days": define("policy.refund_bank_days", {
    group: "policies",
    label: "Bank / wallet refund time",
    description: "Time banks and wallets usually take to show a refund, e.g. '5 to 7 working days'.",
    schema: nonEmpty,
    placeholder: `${PH} — Bank refund time`,
    requiredForLaunch: true,
  }),
  "policy.cod_refund_days": define("policy.cod_refund_days", {
    group: "policies",
    label: "COD refund (working days)",
    description: "Working days to send a COD refund after receiving UPI/bank details.",
    schema: z.number().int().min(0).max(60),
    placeholder: 0,
    requiredForLaunch: true,
  }),
  "policy.replacement_days": define("policy.replacement_days", {
    group: "policies",
    label: "Replacement dispatch time",
    description: "Returns policy: time to dispatch a replacement.",
    schema: nonEmpty,
    placeholder: `${PH} — Replacement dispatch time`,
    requiredForLaunch: true,
  }),
  "policy.return_conditions": define("policy.return_conditions", {
    group: "policies",
    label: "Return conditions (Markdown)",
    description: "Returns policy. Required only when the return policy type is not no_returns.",
    schema: nonEmpty,
    placeholder: `${PH} — Return conditions`,
    requiredForLaunch: true,
    requiredUnless: { key: "return_policy_type", equals: "no_returns" },
    format: "md",
  }),
  "policy.non_returnable_items": define("policy.non_returnable_items", {
    group: "policies",
    label: "Non-returnable items (Markdown)",
    description: "Returns policy. Required only when the return policy type is not no_returns.",
    schema: nonEmpty,
    placeholder: `${PH} — Non-returnable items`,
    requiredForLaunch: true,
    requiredUnless: { key: "return_policy_type", equals: "no_returns" },
    format: "md",
  }),
  "policy.return_shipping_rule": define("policy.return_shipping_rule", {
    group: "policies",
    label: "Return shipping rule (Markdown)",
    description:
      "Who arranges and pays return shipping. Required only when the return policy type is not no_returns.",
    schema: nonEmpty,
    placeholder: `${PH} — Return shipping rule`,
    requiredForLaunch: true,
    requiredUnless: { key: "return_policy_type", equals: "no_returns" },
    format: "md",
  }),
  "policy.shipping_fee_refund_rule": define("policy.shipping_fee_refund_rule", {
    group: "policies",
    label: "Shipping fee refund rule (Markdown)",
    description: "Whether shipping and COD fees are refunded in partial refunds.",
    schema: nonEmpty,
    placeholder: `${PH} — Shipping fee refund rule`,
    requiredForLaunch: true,
    format: "md",
  }),
  "policy.retention_order_records": define("policy.retention_order_records", {
    group: "policies",
    label: "Order record retention",
    description: "Privacy notice: how long order and invoice records are kept.",
    schema: nonEmpty,
    placeholder: `${PH} — Order record retention`,
    requiredForLaunch: true,
  }),
  "policy.retention_period": define("policy.retention_period", {
    group: "policies",
    label: "Other data retention",
    description: "Privacy notice: how long other personal data is kept.",
    schema: nonEmpty,
    placeholder: `${PH} — Data retention period`,
    requiredForLaunch: true,
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]["schema"]>;
export type SettingInput<K extends SettingKey> = z.input<(typeof SETTINGS)[K]["schema"]>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function getDefinition<K extends SettingKey>(key: K): (typeof SETTINGS)[K] {
  return SETTINGS[key];
}

/**
 * Whether a setting blocks launch while it is a placeholder. `requiredUnless` makes a key optional once
 * its governing setting has the given value; `valueOf` reads the governing setting.
 */
export function isRequiredForLaunch(
  def: Pick<SettingDefinition, "requiredForLaunch" | "requiredUnless">,
  valueOf: (key: string) => unknown,
): boolean {
  if (!def.requiredForLaunch) return false;
  return !(def.requiredUnless && valueOf(def.requiredUnless.key) === def.requiredUnless.equals);
}

export function settingsInGroup(group: SettingGroup): SettingKey[] {
  return SETTING_KEYS.filter((k) => SETTINGS[k].group === group);
}
