/**
 * SEO helpers (pure, no Next imports): absolute URLs, canonical paths and JSON-LD builders.
 * Canonicals never carry `?vibe` (theme) or filter params.
 */

const FALLBACK_SITE_URL = "http://localhost:3000";

/**
 * Public origin of the site, without a trailing slash. The localhost fallback is for local work and
 * `next build` only: a production server refuses to boot without NEXT_PUBLIC_SITE_URL
 * (`assertProductionEnv`, called from `instrumentation-node.ts`), so it never serves localhost links.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_SITE_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface Crumb {
  name: string;
  /** Site-relative path. */
  path: string;
}

export function breadcrumbJsonLd(crumbs: readonly Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

export function organizationJsonLd(input: {
  name: string;
  legalName?: string;
  logoPath?: string;
  email?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    ...(input.legalName ? { legalName: input.legalName } : {}),
    url: absoluteUrl("/"),
    ...(input.logoPath ? { logo: absoluteUrl(input.logoPath) } : {}),
    ...(input.email ? { email: input.email } : {}),
  };
}

/** Serialises JSON-LD so it can sit inside a `<script>` tag (`<` escaped against `</script>` breakouts). */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** A policy/seo text that still starts with the settings placeholder marker is not usable as page copy. */
export function isPlaceholderText(value: string | null | undefined): boolean {
  return !value || value.trim().startsWith("PLACEHOLDER");
}

/** `value` unless it is empty or a placeholder, then `fallback`. */
export function textOr(value: string | null | undefined, fallback: string): string {
  return isPlaceholderText(value) ? fallback : (value as string).trim();
}
