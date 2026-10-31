import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { SETTINGS_TAG } from "@/server/cache/tags";
import { getSettings } from "@/server/services/settings";

/**
 * Return-policy summary shown on the PDP, in the cart drawer and on the cart page (plan section 3: shown
 * before purchase). Reads the `returns` settings (cached, tag `settings`) so the wording follows the owner's
 * choice; the full policy lives at `/policies/returns-refunds`.
 */

export interface ReturnPolicySummary {
  /** One or two sentences, plain language. */
  text: string;
}

export function summariseReturnPolicy(type: unknown, windowDays: unknown): ReturnPolicySummary {
  if (type === "returns_window" && typeof windowDays === "number" && windowDays > 0) {
    return {
      text: `You can return unused items within ${windowDays} ${windowDays === 1 ? "day" : "days"} of delivery. Damaged, defective or wrong items are always covered.`,
    };
  }
  return {
    text: "We don't take change-of-mind returns. If an item arrives damaged, defective or not what you ordered, report it and we'll make it right.",
  };
}

export async function getReturnPolicySummary(): Promise<ReturnPolicySummary> {
  "use cache";
  cacheLife("hours");
  cacheTag(SETTINGS_TAG);
  const entries = await getSettings("returns");
  const value = (key: string) => entries.find((e) => e.key === key)?.value;
  return summariseReturnPolicy(value("return_policy_type"), value("returns_window_days"));
}
