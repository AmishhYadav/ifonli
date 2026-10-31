"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateContent } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  createFaq,
  deleteFaq,
  moveFaq,
  setFaqPublished,
  updateFaq,
} from "@/server/services/admin/faq";
import { previewPolicyBody, type PolicyPreview } from "@/server/services/admin/policies";

const idSchema = z.uuid();

export async function createFaqAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("content:manage", async ({ actor }) => {
    const out = await createFaq(getDb(), input, actor);
    revalidateContent();
    return out;
  });
}

export async function updateFaqAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("content:manage", async ({ actor }) => {
    const out = await updateFaq(getDb(), idSchema.parse(id), input, actor);
    revalidateContent();
    return out;
  });
}

export async function setFaqPublishedAction(id: string, published: boolean): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await setFaqPublished(getDb(), idSchema.parse(id), z.boolean().parse(published), actor);
    revalidateContent();
    return undefined;
  });
}

export async function deleteFaqAction(id: string): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await deleteFaq(getDb(), idSchema.parse(id), actor);
    revalidateContent();
    return undefined;
  });
}

export async function moveFaqAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await moveFaq(getDb(), idSchema.parse(id), z.enum(["up", "down"]).parse(direction), actor);
    revalidateContent();
    return undefined;
  });
}

/** Live preview of an answer (tokens filled, problems marked). Read-only. */
export async function previewFaqAction(markdown: string): Promise<ActionResult<PolicyPreview>> {
  return runAdminAction("content:view", async () =>
    previewPolicyBody(getDb(), z.string().max(8000).parse(markdown)),
  );
}
