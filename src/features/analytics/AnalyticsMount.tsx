import { Suspense } from "react";

import { getAnalyticsConfig, NO_ANALYTICS, type AnalyticsConfig } from "@/server/cache/analytics-config";

import { AnalyticsProvider } from "./AnalyticsProvider";
import { ConsentManager } from "./ConsentManager";
import { CookieSettingsLink } from "./CookieSettingsLink";

/** The config read must never take a storefront page down: without it, GA4 simply stays off. */
async function loadConfig(): Promise<AnalyticsConfig> {
  try {
    return await getAnalyticsConfig();
  } catch (error) {
    console.error("analytics: could not read config, GA4 stays off", error instanceof Error ? error.message : error);
    return NO_ANALYTICS;
  }
}

/**
 * Server wrapper mounted once per storefront layout: first-party tracking plus the optional GA4 and its banner.
 * Inside its own Suspense boundary: the provider reads the URL (`usePathname`), which Cache Components only
 * allows below a boundary, and nothing here is part of the page's shell anyway.
 */
export function AnalyticsMount() {
  return (
    <Suspense fallback={null}>
      <AnalyticsMountContent />
    </Suspense>
  );
}

async function AnalyticsMountContent() {
  const config = await loadConfig();
  return (
    <>
      <AnalyticsProvider />
      <ConsentManager ga4Id={config.ga4Id} consentRequired={config.consentRequired} />
    </>
  );
}

/** "Cookie settings" footer button; renders nothing unless GA4 is configured and needs consent. */
export async function AnalyticsFooterLink({ className }: { className?: string }) {
  const config = await loadConfig();
  if (!config.ga4Id || !config.consentRequired) return null;
  return <CookieSettingsLink className={className} />;
}
