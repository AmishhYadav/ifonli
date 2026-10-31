import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { CONTENT_TAG, SETTINGS_TAG } from "@/server/cache/tags";
import { getDb } from "@/server/db";

import { isReviewMode } from "./publish";
import {
  loadHelpFaqs,
  loadPolicyIndex,
  loadPolicyPage,
  type HelpFaqGroup,
  type PolicyPage,
} from "./policies";

/**
 * Cached policy / FAQ reads. Output depends on both content (`policies`, `faqs`) and the settings the
 * tokens are filled from, so entries carry both tags: an admin edit of either expires them.
 */

export async function getPolicyPage(slug: string): Promise<PolicyPage | null> {
  "use cache";
  cacheLife("days");
  cacheTag(CONTENT_TAG, SETTINGS_TAG);
  return loadPolicyPage(getDb(), slug, { review: isReviewMode() });
}

export async function getPolicyIndex(): Promise<{ slug: string; title: string; published: boolean }[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CONTENT_TAG, SETTINGS_TAG);
  return loadPolicyIndex(getDb(), { review: isReviewMode() });
}

export async function getHelpFaqs(): Promise<HelpFaqGroup[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CONTENT_TAG, SETTINGS_TAG);
  return loadHelpFaqs(getDb(), { review: isReviewMode() });
}
