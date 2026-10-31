import path from "node:path";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { loadHelpFaqs, loadPolicyPage, loadPolicyIndex, POLICY_SLUGS } from "@/server/content/policies";
import {
  loadContentFiles,
  parsePolicyFile,
  seedFaqs,
  seedPolicies,
} from "@/server/content/seed";
import { getDb } from "@/server/db";
import { contactMessages, faqs, notificationOutbox, policies, policyVersions, rateLimits } from "@/server/db/schema";
import {
  CONTACT_LIMITS,
  createContactMessage,
} from "@/server/services/support";
import { seedMissingSettings, setSetting } from "@/server/services/settings";

const CONTENT_DIR = path.resolve(process.cwd(), "content");
const db = () => getDb();

const draftFile = (body = "# T\n\nHello {{settings.brand_name}}", status = "DRAFT — needs review") =>
  parsePolicyFile(
    `---\ntitle: "Test Policy"\nslug: test-policy\nversion: 1.0\nstatus: "${status}"\nlastReviewed: null\n---\n\n${body}\n`,
  );

describe("seed-content", () => {
  it("loads every policy file and the FAQ file, idempotently", async () => {
    const content = await loadContentFiles(CONTENT_DIR);
    expect(content.policies.map((p) => p.slug).sort()).toEqual([...POLICY_SLUGS].sort());
    expect(content.policies.every((p) => p.draft)).toBe(true);

    const first = await seedPolicies(db(), content.policies);
    const firstFaq = await seedFaqs(db(), content.faqs);
    expect(first).toEqual({ inserted: 7, updated: 0, unchanged: 0 });
    expect(firstFaq.inserted).toBe(content.faqs.length);

    const second = await seedPolicies(db(), content.policies);
    const secondFaq = await seedFaqs(db(), content.faqs);
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 7 });
    expect(secondFaq).toEqual({ inserted: 0, updated: 0, unchanged: content.faqs.length });

    const rows = await db().select().from(policies);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.published === false && r.version === 1 && r.effectiveAt === null)).toBe(true);
    expect(await db().select().from(policyVersions)).toHaveLength(7);
    expect(await db().select().from(faqs)).toHaveLength(content.faqs.length);
  });

  it("body is the text after the front matter and DRAFT status keeps it unpublished", () => {
    const file = draftFile();
    expect(file.bodyMd).toBe("# T\n\nHello {{settings.brand_name}}\n");
    expect(file).toMatchObject({ draft: true, version: 1, slug: "test-policy" });
    expect(draftFile("x", "Reviewed by counsel").draft).toBe(false);
    expect(parsePolicyFile("---\ntitle: A\nslug: a\nversion: 0.1-draft\nstatus: DRAFT\nlastReviewed: null\n---\nb").version).toBe(1);
    expect(parsePolicyFile("---\ntitle: A\nslug: a\nversion: 3.2\nstatus: ok\nlastReviewed: 2026-11-01\n---\nb")).toMatchObject({
      version: 3,
      lastReviewed: "2026-11-01",
    });
    expect(() => parsePolicyFile("---\ntitle: A\nversion: 1\nstatus: ok\n---\nb")).toThrow(/slug/);
  });

  it("refreshes a draft from its file, never touches a published policy, publishes once DRAFT is cleared", async () => {
    await seedPolicies(db(), [draftFile("v1")]);
    expect(await seedPolicies(db(), [draftFile("v2")])).toMatchObject({ updated: 1 });
    const [row] = await db().select().from(policies).where(eq(policies.slug, "test-policy"));
    expect(row?.bodyMd).toBe("v2\n");
    const versions = await db().select().from(policyVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.bodyMd).toBe("v2\n");

    const final = draftFile("final", "Reviewed");
    expect(await seedPolicies(db(), [final])).toMatchObject({ updated: 1 });
    const [published] = await db().select().from(policies).where(eq(policies.slug, "test-policy"));
    expect(published?.published).toBe(true);

    // Owner edit in admin survives a reseed with a different file body.
    await db().update(policies).set({ bodyMd: "edited in admin\n" }).where(eq(policies.slug, "test-policy"));
    expect(await seedPolicies(db(), [draftFile("v3", "Reviewed")])).toMatchObject({ unchanged: 1 });
    const [kept] = await db().select().from(policies).where(eq(policies.slug, "test-policy"));
    expect(kept?.bodyMd).toBe("edited in admin\n");
    // --force overwrites.
    expect(await seedPolicies(db(), [draftFile("v3", "Reviewed")], { force: true })).toMatchObject({ updated: 1 });
  });
});

describe("policy publish gating", () => {
  const seedOne = async (body: string, published: boolean) => {
    await db().insert(policies).values({ slug: "shipping", title: "Shipping Policy", bodyMd: body, published });
  };

  it("production withholds an unpublished policy, review mode shows it as draft", async () => {
    await seedMissingSettings();
    await seedOne("# Shipping\n\nHello {{settings.brand_name}}", false);
    const prod = await loadPolicyPage(db(), "shipping", { review: false });
    expect(prod).toMatchObject({ html: "", withheld: "unpublished", draft: true });
    const review = await loadPolicyPage(db(), "shipping", { review: true });
    expect(review).toMatchObject({ withheld: null, draft: true, published: false });
    expect(review?.html).toContain("Hello IfOnli");
    expect(review?.html).not.toContain("<h1");
  });

  it("production withholds a published policy with PLACEHOLDER or unresolved tokens", async () => {
    await seedMissingSettings();
    await seedOne("Sold by {{settings.legal_name}}. {{settings.nope}}", true);
    const prod = await loadPolicyPage(db(), "shipping", { review: false });
    expect(prod?.withheld).toBe("unresolved");
    expect(prod?.html).toBe("");
    expect(prod?.problems.map((p) => [p.kind, p.token])).toEqual([
      ["placeholder", "settings.legal_name"],
      ["unresolved", "settings.nope"],
    ]);
    const review = await loadPolicyPage(db(), "shipping", { review: true });
    expect(review?.html).toContain('data-marker="placeholder"');
    expect(review?.html).toContain('data-marker="unresolved"');
  });

  it("publishes once every token has a real value", async () => {
    await seedMissingSettings();
    await seedOne("Sold by {{settings.legal_name}} in {{settings.policy.jurisdiction_city}}.", true);
    await setSetting("legal_name", "Acme Pvt Ltd", null);
    expect((await loadPolicyPage(db(), "shipping", { review: false }))?.withheld).toBe("unresolved");
    await setSetting("policy.jurisdiction_city", "Pune", null);
    const page = await loadPolicyPage(db(), "shipping", { review: false });
    expect(page).toMatchObject({ withheld: null, draft: false, problems: [] });
    expect(page?.html).toContain("Sold by Acme Pvt Ltd in Pune.");
  });

  it("only blocks on return copy when returns are enabled", async () => {
    await seedMissingSettings();
    await seedOne("{{#if settings.return_policy_type != \"no_returns\"}}\n{{settings.policy.return_conditions}}\n{{else}}\nNo returns.\n{{/if}}", true);
    await setSetting("return_policy_type", "no_returns", null);
    expect((await loadPolicyPage(db(), "shipping", { review: false }))?.withheld).toBeNull();
    await setSetting("return_policy_type", "returns_window", null);
    const page = await loadPolicyPage(db(), "shipping", { review: false });
    expect(page?.withheld).toBe("unresolved");
  });

  it("unknown slug gives null; the index hides unpublished policies in production", async () => {
    await seedOne("x", false);
    expect(await loadPolicyPage(db(), "nope", { review: true })).toBeNull();
    expect(await loadPolicyIndex(db(), { review: false })).toEqual([]);
    expect(await loadPolicyIndex(db(), { review: true })).toHaveLength(1);
  });
});

describe("FAQs", () => {
  it("orders categories delivery, payment, product, orders and rows by position; skips unpublished", async () => {
    await db().insert(faqs).values([
      { category: "orders", question: "O2", answerMd: "a", position: 2 },
      { category: "orders", question: "O1", answerMd: "a", position: 1 },
      { category: "delivery", question: "D1", answerMd: "a", position: 1 },
      { category: "product", question: "P1", answerMd: "a", position: 1 },
      { category: "payment", question: "Pay1", answerMd: "a", position: 1 },
      { category: "payment", question: "Hidden", answerMd: "a", position: 0, published: false },
    ]);
    const groups = await loadHelpFaqs(db(), { review: true });
    expect(groups.map((g) => g.category)).toEqual(["delivery", "payment", "product", "orders"]);
    expect(groups.find((g) => g.category === "orders")?.items.map((i) => i.question)).toEqual(["O1", "O2"]);
    expect(groups.find((g) => g.category === "payment")?.items.map((i) => i.question)).toEqual(["Pay1"]);
  });

  it("renders answers through the template engine and hides unresolved answers in production", async () => {
    await seedMissingSettings();
    await setSetting("support_email", "help@example.com", null);
    await db().insert(faqs).values([
      { category: "delivery", question: "Ok?", answerMd: "Mail **{{settings.support_email}}**", position: 1 },
      { category: "delivery", question: "Placeholder?", answerMd: "{{settings.support_phone}}", position: 2 },
    ]);
    const prod = await loadHelpFaqs(db(), { review: false });
    expect(prod[0]?.items.map((i) => i.question)).toEqual(["Ok?"]);
    expect(prod[0]?.items[0]?.html).toContain("help@example.com</a></strong>");
    expect(prod[0]?.items[0]?.text).toBe("Mail help@example.com");
    const review = await loadHelpFaqs(db(), { review: true });
    expect(review[0]?.items.map((i) => [i.question, i.draft])).toEqual([
      ["Ok?", false],
      ["Placeholder?", true],
    ]);
  });

  it("seeds the real faq.json: every category present, positions ascending", async () => {
    const content = await loadContentFiles(CONTENT_DIR);
    await seedFaqs(db(), content.faqs);
    const groups = await loadHelpFaqs(db(), { review: true });
    expect(groups.map((g) => g.category)).toEqual(["delivery", "payment", "product", "orders"]);
    const expected = content.faqs.filter((f) => f.category === "delivery").sort((a, b) => a.position - b.position);
    expect(groups[0]?.items.map((i) => i.question)).toEqual(expected.map((f) => f.question));
  });
});

describe("createContactMessage", () => {
  const valid = {
    name: "Asha Rao",
    email: "Asha@Example.com",
    phone: "98765 43210",
    orderRef: "ifo-2611-7k3q",
    message: "My order has not arrived yet, please help.",
  };

  it("stores the message and enqueues the acknowledgement and the admin alert", async () => {
    const result = await createContactMessage(db(), valid, { ip: "1.2.3.4" });
    expect(result.ok).toBe(true);
    const [row] = await db().select().from(contactMessages);
    expect(row).toMatchObject({
      name: "Asha Rao",
      email: "asha@example.com",
      phone: "+919876543210",
      orderRef: "IFO-2611-7K3Q",
      status: "new",
    });
    const outbox = await db().select().from(notificationOutbox);
    const ack = outbox.find((o) => o.template === "contact_ack");
    const alert = outbox.find((o) => o.template === "new_contact");
    expect(ack).toMatchObject({ to: "asha@example.com", status: "pending", channel: "email" });
    expect(ack?.payload).toMatchObject({ name: "Asha Rao", messageId: row?.id });
    expect(alert?.payload).toMatchObject({ email: "asha@example.com", orderRef: "IFO-2611-7K3Q", messageId: row?.id });
    expect(outbox).toHaveLength(2);
  });

  it("treats phone and order reference as optional", async () => {
    const result = await createContactMessage(db(), { name: "Bo", email: "bo@example.com", message: "Hello there, a question.", phone: "", orderRef: " " }, { ip: "1.1.1.1" });
    expect(result.ok).toBe(true);
    const [row] = await db().select().from(contactMessages);
    expect(row?.phone).toBeNull();
    expect(row?.orderRef).toBeNull();
  });

  it("validates fields and writes nothing", async () => {
    const result = await createContactMessage(
      db(),
      { name: "A", email: "nope", phone: "123", message: "short" },
      { ip: "1.2.3.4" },
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok || result.reason !== "invalid") throw new Error("expected invalid");
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["email", "message", "name", "phone"]);
    expect(await db().select().from(contactMessages)).toHaveLength(0);
    expect(await db().select().from(notificationOutbox)).toHaveLength(0);
    expect(await db().select().from(rateLimits)).toHaveLength(0);
  });

  it("enforces the 10 to 2000 character message length", async () => {
    const msg = (n: number) => ({ ...valid, message: "x".repeat(n) });
    expect((await createContactMessage(db(), msg(9), { ip: "9.9.9.1" })).ok).toBe(false);
    expect((await createContactMessage(db(), msg(2001), { ip: "9.9.9.2" })).ok).toBe(false);
    expect((await createContactMessage(db(), { ...msg(2000), email: "a1@example.com" }, { ip: "9.9.9.3" })).ok).toBe(true);
  });

  it("swallows honeypot submissions without storing anything", async () => {
    const result = await createContactMessage(db(), { ...valid, website: "http://spam.example" }, { ip: "1.2.3.4" });
    expect(result).toEqual({ ok: true, id: null });
    expect(await db().select().from(contactMessages)).toHaveLength(0);
    expect(await db().select().from(notificationOutbox)).toHaveLength(0);
  });

  it("rate limits per e-mail address", async () => {
    for (let i = 0; i < CONTACT_LIMITS.email.limit; i++) {
      expect((await createContactMessage(db(), valid, { ip: `10.0.0.${i}` })).ok).toBe(true);
    }
    const blocked = await createContactMessage(db(), valid, { ip: "10.0.0.99" });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await db().select().from(contactMessages)).toHaveLength(CONTACT_LIMITS.email.limit);
  });

  it("rate limits per IP across different e-mail addresses", async () => {
    for (let i = 0; i < CONTACT_LIMITS.ip.limit; i++) {
      expect((await createContactMessage(db(), { ...valid, email: `p${i}@example.com` }, { ip: "7.7.7.7" })).ok).toBe(true);
    }
    const blocked = await createContactMessage(db(), { ...valid, email: "other@example.com" }, { ip: "7.7.7.7" });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    expect((await createContactMessage(db(), { ...valid, email: "other@example.com" }, { ip: "8.8.8.8" })).ok).toBe(true);
  });

  it("skips the customer acknowledgement when the owner turned the e-mail channel off", async () => {
    await seedMissingSettings();
    const channels = Object.fromEntries(
      ["order_confirmed", "cod_order_placed", "payment_failed", "shipped", "delivered", "cancelled", "refund_initiated", "refund_processed", "support_case_update", "contact_ack"].map((e) => [e, { email: e !== "contact_ack", whatsapp: false }]),
    );
    await setSetting("notification_channels", channels as never, null);
    await createContactMessage(db(), valid, { ip: "1.2.3.4" });
    const templates = (await db().select().from(notificationOutbox)).map((o) => o.template);
    expect(templates).toEqual(["new_contact"]);
  });
});
