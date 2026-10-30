/**
 * Webhook payloads carry the payer's e-mail, phone, card and UPI details. We only need ids,
 * amounts and statuses, so these keys are dropped (at any depth) before a payload is stored in
 * `webhook_events` or `payments.raw`.
 */
const PII_KEYS = new Set([
  "email",
  "contact",
  "vpa",
  "card",
  "card_id",
  "bank",
  "wallet",
  "upi",
  "acquirer_data",
  "notes",
  "customer_id",
  "token_id",
  "billing_address",
  "shipping_address",
  "address",
  "name",
  "phone",
]);

export function sanitizeWebhookPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeWebhookPayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizeWebhookPayload(v, depth + 1);
    }
    return out;
  }
  return value;
}
