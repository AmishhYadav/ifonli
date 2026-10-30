import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "@/server/db";
import * as content from "@/server/services/content";
import type {
  ActiveBanner,
  BannerPlacement,
  FaqGroup,
  PolicyDoc,
} from "@/server/services/content";

import { CONTENT_TAG } from "./tags";

/**
 * Cached content reads. Banners are schedule-dependent (`starts_at` / `ends_at`), so they use the
 * short `minutes` profile: a banner appears/disappears within that window even without an admin
 * edit. Editing content calls `revalidateContent()` (tag `content`).
 */

export async function getActiveBanners(opts: {
  placement: BannerPlacement;
  vibe?: string;
}): Promise<ActiveBanner[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(CONTENT_TAG);
  return content.getActiveBanners(getDb(), { ...opts, now: new Date() });
}

export async function getFaqs(): Promise<FaqGroup[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CONTENT_TAG);
  return content.getFaqs(getDb());
}

export async function getPolicy(slug: string): Promise<PolicyDoc | null> {
  "use cache";
  cacheLife("days");
  cacheTag(CONTENT_TAG);
  return content.getPolicy(getDb(), slug);
}

export async function listPublishedPolicies(): Promise<{ slug: string; title: string }[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CONTENT_TAG);
  return content.listPublishedPolicies(getDb());
}
