"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { getDb } from "@/server/db";
import { createCoupon, setCouponActive, updateCoupon } from "@/server/services/admin/discounts";

const idSchema = z.uuid();

export async function createCouponAction(input: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  return runAdminAction("coupon:manage", async ({ actor }) => createCoupon(getDb(), input, actor));
}

export async function updateCouponAction(id: string, input: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  return runAdminAction("coupon:manage", async ({ actor }) => updateCoupon(getDb(), idSchema.parse(id), input, actor));
}

export async function setCouponActiveAction(id: string, active: boolean): Promise<ActionResult<{ id: string; active: boolean }>> {
  return runAdminAction("coupon:manage", async ({ actor }) =>
    setCouponActive(getDb(), idSchema.parse(id), z.boolean().parse(active), actor),
  );
}
