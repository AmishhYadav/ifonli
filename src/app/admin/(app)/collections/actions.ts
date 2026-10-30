"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateCatalog } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  setFeaturedOrder,
  updateTypeCopy,
  updateVibeCopy,
} from "@/server/services/admin/collections";

const id = z.uuid();

export async function updateVibeAction(vibeId: string, input: unknown): Promise<ActionResult> {
  return runAdminAction("collection:update", async ({ actor }) => {
    revalidateCatalog(await updateVibeCopy(getDb(), id.parse(vibeId), input, actor));
    return undefined;
  });
}

export async function updateTypeAction(typeId: string, input: unknown): Promise<ActionResult> {
  return runAdminAction("collection:update", async ({ actor }) => {
    revalidateCatalog(await updateTypeCopy(getDb(), id.parse(typeId), input, actor));
    return undefined;
  });
}

export async function setFeaturedOrderAction(
  vibeId: string,
  orderedProductIds: string[],
): Promise<ActionResult> {
  return runAdminAction("collection:update", async ({ actor }) => {
    revalidateCatalog(await setFeaturedOrder(getDb(), id.parse(vibeId), orderedProductIds, actor));
    return undefined;
  });
}
