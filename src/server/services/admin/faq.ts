import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { assertCan } from "@/server/auth/permissions";
import { faqs } from "@/server/db/schema";
import { loadTemplateContext } from "@/server/content/policies";
import { renderTemplate, type TemplateProblem } from "@/server/content/render-template";
import { writeAudit } from "@/server/services/audit";
import { FAQ_CATEGORY_ORDER, type FaqCategory } from "@/server/services/content";
import type { DbClient } from "@/server/services/queries/shared";

import { diffFields } from "./product-schema";
import { AdminInputError, type AdminActor } from "./products";

/**
 * Admin FAQ. Answers are Markdown with `{{settings.*}}` tokens (rendered by `/help`). A published answer
 * with an unresolved or placeholder token is hidden from `/help` in production, so the list reports
 * those problems. Each function checks `content:*` and audits; the caller runs `revalidateContent()`.
 */

export const FAQ_CATEGORY_LABELS: Record<FaqCategory, string> = {
  delivery: "Delivery",
  payment: "Payment",
  product: "Product",
  orders: "Orders",
};

export const faqInputSchema = z.object({
  category: z.enum(FAQ_CATEGORY_ORDER as unknown as [FaqCategory, ...FaqCategory[]]),
  question: z.string().trim().min(1, "Question is required").max(300, "At most 300 characters"),
  answerMd: z.string().trim().min(1, "Answer is required").max(8000, "At most 8000 characters"),
  published: z.boolean().default(true),
});
export type FaqInput = z.input<typeof faqInputSchema>;

export interface AdminFaq {
  id: string;
  category: FaqCategory;
  question: string;
  answerMd: string;
  position: number;
  published: boolean;
  /** Token problems that make `/help` hide this answer (published answers only matter in production). */
  problems: TemplateProblem[];
}

export async function listFaqsAdmin(db: DbClient): Promise<AdminFaq[]> {
  const [rows, ctx] = await Promise.all([
    db.select().from(faqs).orderBy(asc(faqs.position), asc(faqs.createdAt), asc(faqs.id)),
    loadTemplateContext(db),
  ]);
  return FAQ_CATEGORY_ORDER.flatMap((category) =>
    rows
      .filter((r) => r.category === category)
      .map((r) => ({
        id: r.id,
        category: r.category,
        question: r.question,
        answerMd: r.answerMd,
        position: r.position,
        published: r.published,
        problems: renderTemplate(r.answerMd, ctx).problems,
      })),
  );
}

export async function createFaq(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<{ id: string }> {
  assertCan(actor.role, "content:manage");
  const input = faqInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ pos: sql<number | null>`max(${faqs.position})` })
      .from(faqs)
      .where(eq(faqs.category, input.category));
    const [row] = await tx
      .insert(faqs)
      .values({ ...input, position: (last?.pos ?? 0) + 1 })
      .returning({ id: faqs.id });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "faq.create",
      entity: "faq",
      entityId: row!.id,
      diff: input,
      ip: actor.ip,
    });
    return { id: row!.id };
  });
}

export async function updateFaq(
  db: DbClient,
  faqId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<{ id: string }> {
  assertCan(actor.role, "content:manage");
  const input = faqInputSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(faqs).where(eq(faqs.id, faqId)).for("update");
    if (!before) throw new AdminInputError("Question not found");
    // Changing the category puts it last in the new one.
    let position = before.position;
    if (before.category !== input.category) {
      const [last] = await tx
        .select({ pos: sql<number | null>`max(${faqs.position})` })
        .from(faqs)
        .where(eq(faqs.category, input.category));
      position = (last?.pos ?? 0) + 1;
    }
    await tx
      .update(faqs)
      .set({ ...input, position })
      .where(eq(faqs.id, faqId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "faq.update",
      entity: "faq",
      entityId: faqId,
      diff: diffFields(
        {
          category: before.category,
          question: before.question,
          answerMd: before.answerMd,
          published: before.published,
        },
        input,
      ),
      ip: actor.ip,
    });
  });
  return { id: faqId };
}

export async function setFaqPublished(
  db: DbClient,
  faqId: string,
  published: boolean,
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "content:manage");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(faqs).where(eq(faqs.id, faqId)).for("update");
    if (!before) throw new AdminInputError("Question not found");
    if (before.published === published) return;
    await tx.update(faqs).set({ published }).where(eq(faqs.id, faqId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: published ? "faq.publish" : "faq.unpublish",
      entity: "faq",
      entityId: faqId,
      diff: { published: { from: before.published, to: published } },
      ip: actor.ip,
    });
  });
}

export async function deleteFaq(db: DbClient, faqId: string, actor: AdminActor): Promise<void> {
  assertCan(actor.role, "content:manage");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(faqs).where(eq(faqs.id, faqId)).for("update");
    if (!before) throw new AdminInputError("Question not found");
    await tx.delete(faqs).where(eq(faqs.id, faqId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "faq.delete",
      entity: "faq",
      entityId: faqId,
      diff: { category: before.category, question: before.question, answerMd: before.answerMd },
      ip: actor.ip,
    });
  });
}

/** Moves a question one step up or down within its category (positions are renumbered 1..n). */
export async function moveFaq(
  db: DbClient,
  faqId: string,
  direction: "up" | "down",
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "content:manage");
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(faqs).where(eq(faqs.id, faqId));
    if (!target) throw new AdminInputError("Question not found");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"faqs:" + target.category}))`);
    const siblings = await tx
      .select({ id: faqs.id, position: faqs.position })
      .from(faqs)
      .where(eq(faqs.category, target.category))
      .orderBy(asc(faqs.position), asc(faqs.createdAt), asc(faqs.id));
    const order = siblings.map((s) => s.id);
    const i = order.indexOf(faqId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [index, id] of order.entries()) {
      const position = index + 1;
      if (siblings.find((s) => s.id === id)!.position !== position) {
        await tx.update(faqs).set({ position }).where(eq(faqs.id, id));
      }
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "faq.reorder",
      entity: "faq",
      entityId: faqId,
      diff: { category: target.category, direction, order },
      ip: actor.ip,
    });
  });
}
