import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getServerEnv } from "@/lib/env";
import { getSettings } from "@/server/services/settings";

import { SETTINGS_TAG } from "./tags";

export interface AnalyticsConfig {
  /** GA4 measurement id, or null: GA4 is optional and off by default. */
  ga4Id: string | null;
  /** True: GA4 waits for an explicit choice in the consent banner (the default, DPDP). */
  consentRequired: boolean;
}

export const NO_ANALYTICS: AnalyticsConfig = { ga4Id: null, consentRequired: true };

const GA4_ID = /^G-[A-Z0-9]+$/;

/**
 * Storefront analytics config (cached with the `settings` tag). The `NEXT_PUBLIC_GA4_ID` environment
 * variable wins; the admin setting `ga4_measurement_id` is the fallback. Nothing is loaded in the browser
 * unless an id exists, and with `consent_required` (default true) not before the visitor allows it.
 * First-party event counting is not governed by this: it is anonymous and always on (plan 3, D-23).
 */
export async function getAnalyticsConfig(): Promise<AnalyticsConfig> {
  "use cache";
  cacheLife("hours");
  cacheTag(SETTINGS_TAG);
  const entries = await getSettings("analytics");
  const fromSetting = entries.find((e) => e.key === "ga4_measurement_id")?.value;
  const required = entries.find((e) => e.key === "consent_required")?.value;
  const envId = getServerEnv().NEXT_PUBLIC_GA4_ID;
  const candidate = envId ?? (typeof fromSetting === "string" ? fromSetting : null);
  return {
    ga4Id: candidate && GA4_ID.test(candidate) ? candidate : null,
    consentRequired: typeof required === "boolean" ? required : true,
  };
}
