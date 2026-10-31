"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateContent } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  createBanner,
  deleteBanner,
  moveBanner,
  prepareBannerImageUpload,
  setBannerActive,
  updateBanner,
  verifyBannerImage,
  type PreparedBannerUpload,
} from "@/server/services/admin/banners";
import { setFeaturedSlots } from "@/server/services/admin/featured";
import { resolveImageUrl } from "@/server/services/media";

const idSchema = z.uuid();

export async function createBannerAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("content:manage", async ({ actor }) => {
    const out = await createBanner(getDb(), input, actor);
    revalidateContent();
    return out;
  });
}

export async function updateBannerAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("content:manage", async ({ actor }) => {
    const out = await updateBanner(getDb(), idSchema.parse(id), input, actor);
    revalidateContent();
    return out;
  });
}

export async function setBannerActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await setBannerActive(getDb(), idSchema.parse(id), z.boolean().parse(active), actor);
    revalidateContent();
    return undefined;
  });
}

export async function deleteBannerAction(id: string): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await deleteBanner(getDb(), idSchema.parse(id), actor);
    revalidateContent();
    return undefined;
  });
}

export async function moveBannerAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await moveBanner(getDb(), idSchema.parse(id), z.enum(["up", "down"]).parse(direction), actor);
    revalidateContent();
    return undefined;
  });
}

export async function prepareBannerImageAction(
  extension: string,
): Promise<ActionResult<PreparedBannerUpload>> {
  return runAdminAction("content:manage", async ({ actor }) =>
    prepareBannerImageUpload({ extension: z.string().max(8).parse(extension) }, actor),
  );
}

export async function verifyBannerImageAction(
  dbPath: string,
): Promise<ActionResult<{ dbPath: string; previewUrl: string | null; warnings: string[] }>> {
  return runAdminAction("content:manage", async ({ actor }) => {
    const out = await verifyBannerImage({ dbPath: z.string().max(300).parse(dbPath) }, actor);
    let previewUrl: string | null = null;
    try {
      previewUrl = resolveImageUrl(out.dbPath);
    } catch {
      previewUrl = null;
    }
    return { dbPath: out.dbPath, previewUrl, warnings: out.warnings };
  });
}

export async function setFeaturedSlotsAction(input: {
  vibeId: string;
  placement: string;
  productIds: string[];
}): Promise<ActionResult> {
  return runAdminAction("content:manage", async ({ actor }) => {
    await setFeaturedSlots(getDb(), input, actor);
    revalidateContent();
    return undefined;
  });
}
