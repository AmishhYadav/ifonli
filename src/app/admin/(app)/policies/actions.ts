"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateContent } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  previewPolicyBody,
  publishPolicy,
  restorePolicyVersion,
  savePolicyDraft,
  type PolicyPreview,
} from "@/server/services/admin/policies";

const slugSchema = z.string().max(60);

export async function savePolicyDraftAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  return runAdminAction("policy:edit", async ({ actor }) => {
    const out = await savePolicyDraft(getDb(), slugSchema.parse(slug), input, actor);
    // An unpublished policy is its own draft (shown in review mode), so expire the storefront entries too.
    revalidateContent();
    return out;
  });
}

export async function publishPolicyAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  return runAdminAction("policy:publish", async ({ actor }) => {
    const out = await publishPolicy(getDb(), slugSchema.parse(slug), input, actor);
    revalidateContent();
    return out;
  });
}

export async function restorePolicyVersionAction(
  slug: string,
  version: number,
): Promise<ActionResult<{ version: number }>> {
  return runAdminAction("policy:edit", async ({ actor }) => {
    const out = await restorePolicyVersion(
      getDb(),
      slugSchema.parse(slug),
      z.number().int().positive().parse(version),
      actor,
    );
    revalidateContent();
    return out;
  });
}

/** Live editor preview: tokens filled from settings, problem spots marked. Read-only. */
export async function previewPolicyAction(markdown: string): Promise<ActionResult<PolicyPreview>> {
  return runAdminAction("policy:view", async () =>
    previewPolicyBody(getDb(), z.string().max(100_000).parse(markdown), { dropTitle: true }),
  );
}
