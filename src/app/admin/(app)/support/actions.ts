"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { can } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/auth/session";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  addContactMessageNote,
  addSupportCaseNote,
  assignContactMessage,
  assignSupportCase,
  rejectSupportCase,
  replyToContactMessage,
  resolveSupportCase,
  respondToSupportCase,
  setContactMessageStatus,
  setSupportCaseStatus,
  type ResolveCaseResult,
} from "@/server/services/admin/support";

const idSchema = z.uuid();

/* ---- contact inbox ------------------------------------------------------------------------ */

export async function assignMessageAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    await assignContactMessage(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}

export async function setMessageStatusAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    await setContactMessageStatus(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}

export async function noteMessageAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    await addContactMessageNote(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}

export async function replyMessageAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    const r = await replyToContactMessage(getDb(), idSchema.parse(id), input, actor);
    return { id, to: r.to };
  });
}

/* ---- support cases ------------------------------------------------------------------------ */

export async function assignCaseAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    await assignSupportCase(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}

export async function setCaseStatusAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    await setSupportCaseStatus(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}

export async function noteCaseAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    await addSupportCaseNote(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}

export async function respondCaseAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:respond", async ({ actor }) => {
    const r = await respondToSupportCase(getDb(), idSchema.parse(id), input, actor);
    return { id, to: r.to };
  });
}

export async function resolveCaseAction(id: string, input: unknown): Promise<ActionResult<ResolveCaseResult>> {
  return runAdminAction("support:resolve", async ({ actor }) => {
    // A refund moves money: it needs the refund permission on top of resolving cases.
    const resolution = (input as { resolution?: unknown } | null)?.resolution;
    if (resolution === "refund" && !can(actor.role, "order:refund")) {
      throw new ForbiddenError("Refunding needs the refund permission. Ask an admin to resolve this case.");
    }
    const res = await resolveSupportCase(getDb(), idSchema.parse(id), input, actor);
    if (res.productIds.length > 0) revalidateStock({ productIds: res.productIds });
    return res;
  });
}

export async function rejectCaseAction(id: string, input: unknown): Promise<ActionResult<{ id: string; to?: string }>> {
  return runAdminAction("support:resolve", async ({ actor }) => {
    await rejectSupportCase(getDb(), idSchema.parse(id), input, actor);
    return { id };
  });
}
