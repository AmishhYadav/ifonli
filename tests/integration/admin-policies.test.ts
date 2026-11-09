import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { loadPolicyPage } from "@/server/content/policies";
import { getDb } from "@/server/db";
import { adminAuditLog, policies, policyVersions, settings, user } from "@/server/db/schema";
import {
  PolicyPublishBlockedError,
  checkPolicyBody,
  getPolicyEditor,
  istToday,
  listPoliciesAdmin,
  policiesWithPendingDraft,
  previewPolicyBody,
  publishPolicy,
  restorePolicyVersion,
  savePolicyDraft,
} from "@/server/services/admin/policies";
import { getPolicy } from "@/server/services/content";
import { seedMissingSettings, setSetting } from "@/server/services/settings";

const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

async function actors() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Olivia Owner", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
}

const today = () => istToday();
const draft = (bodyMd: string, title = "Shipping policy") => ({ title, bodyMd });

describe("admin policies", () => {
  it("lists every known policy, creating rows on the first draft", async () => {
    await actors();
    const before = await listPoliciesAdmin(getDb());
    expect(before).toHaveLength(6);
    expect(before.every((p) => !p.exists && !p.published)).toBe(true);

    await savePolicyDraft(getDb(), "shipping", draft("# Shipping\n\nWe ship."), admin);
    const row = (await listPoliciesAdmin(getDb())).find((p) => p.slug === "shipping")!;
    expect(row).toMatchObject({ exists: true, published: false, version: 1, hasDraft: true });
    const [v] = await getDb().select().from(policyVersions);
    expect(v).toMatchObject({ version: 1, publishedBy: null });
    await expect(savePolicyDraft(getDb(), "not-a-policy", draft("x"), admin)).rejects.toThrow(
      /Unknown policy/,
    );
  });

  it("an unpublished policy is edited in place (policy row and its version row together)", async () => {
    await actors();
    await savePolicyDraft(getDb(), "shipping", draft("one"), admin);
    await savePolicyDraft(getDb(), "shipping", draft("two", "Shipping v1"), admin);
    const [p] = await getDb().select().from(policies);
    expect(p).toMatchObject({ bodyMd: "two", title: "Shipping v1", version: 1, published: false });
    const versions = await getDb().select().from(policyVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ bodyMd: "two", title: "Shipping v1" });
    const editor = await getPolicyEditor(getDb(), "shipping");
    expect(editor).toMatchObject({ published: false, liveVersion: null, live: null, history: [] });
    expect(editor?.draft).toMatchObject({ bodyMd: "two", version: 1, saved: true });
  });

  it("publishing is owner-only and blocked while tokens are unresolved or placeholders", async () => {
    await actors();
    await seedMissingSettings();
    await savePolicyDraft(
      getDb(),
      "shipping",
      draft(
        "We ship in {{settings.processing_days}} days from {{settings.registered_address}}. {{settings.bogus}}",
      ),
      admin,
    );
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: today() }, admin),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: today() }, fulfilment),
    ).rejects.toThrow(/Forbidden/);

    const err = await publishPolicy(getDb(), "shipping", { effectiveDate: today() }, owner).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(PolicyPublishBlockedError);
    const kinds = (err as PolicyPublishBlockedError).problems
      .map((p) => `${p.kind}:${p.token}`)
      .sort();
    expect(kinds).toEqual([
      "placeholder:settings.processing_days",
      "placeholder:settings.registered_address",
      "unresolved:settings.bogus",
    ]);
    expect((await getDb().select().from(policies))[0]?.published).toBe(false);
    expect((await checkPolicyBody(getDb(), "{{settings.brand_name}}")).length).toBe(0);

    // Fix the settings and the text, then it publishes.
    await setSetting("processing_days", 2, owner.id);
    await setSetting("registered_address", "12 Example Road, Pune", owner.id);
    await savePolicyDraft(
      getDb(),
      "shipping",
      draft("We ship in {{settings.processing_days}} days from {{settings.registered_address}}."),
      admin,
    );
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: today() }, owner),
    ).resolves.toEqual({ version: 1 });
    const [p] = await getDb().select().from(policies);
    expect(p).toMatchObject({ published: true, version: 1 });
    expect(p?.effectiveAt?.toISOString()).toBe(new Date(`${today()}T00:00:00+05:30`).toISOString());
    const [v] = await getDb().select().from(policyVersions);
    expect(v?.publishedBy).toBe(owner.id);
    const [audit] = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "policy.publish"));
    expect(audit).toMatchObject({ actorId: owner.id, entity: "policy", entityId: "shipping" });
    expect(audit?.diff).toMatchObject({ version: { from: null, to: 1 }, effectiveDate: today() });

    // The storefront renders the published text with the tokens filled in.
    const page = await loadPolicyPage(getDb(), "shipping", { review: false });
    expect(page).toMatchObject({ published: true, draft: false, withheld: null, version: 1 });
    expect(page?.html).toContain("2 days from 12 Example Road, Pune");
  });

  it("publish validation: date, empty text, no draft, future dates", async () => {
    await actors();
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: today() }, owner),
    ).rejects.toThrow(/Save a draft/);
    await savePolicyDraft(getDb(), "shipping", draft("Hello"), admin);
    await expect(publishPolicy(getDb(), "shipping", {}, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: "01-11-2026" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: "2999-01-01" }, owner),
    ).rejects.toThrow(/future/);
    await expect(savePolicyDraft(getDb(), "shipping", draft("   "), admin)).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      savePolicyDraft(getDb(), "shipping", draft("x", " "), admin),
    ).rejects.toBeInstanceOf(ZodError);
    // A past date is fine (records when it took effect).
    await expect(
      publishPolicy(getDb(), "shipping", { effectiveDate: "2026-01-05" }, owner),
    ).resolves.toEqual({ version: 1 });
  });

  it("versioning: editing a published policy writes a draft; live text is untouched until publish", async () => {
    await actors();
    await savePolicyDraft(getDb(), "terms", draft("v1 text", "Terms"), admin);
    await publishPolicy(getDb(), "terms", { effectiveDate: "2026-09-01" }, owner);

    // No pending draft yet: the editor starts from the live text and shows version 2 as the next.
    let editor = await getPolicyEditor(getDb(), "terms");
    expect(editor).toMatchObject({ published: true, liveVersion: 1 });
    expect(editor?.draft).toMatchObject({ version: 2, saved: false, bodyMd: "v1 text" });
    await expect(
      publishPolicy(getDb(), "terms", { effectiveDate: today() }, owner),
    ).rejects.toThrow(/no draft/);

    // An unchanged draft cannot be published as a new version.
    await savePolicyDraft(getDb(), "terms", draft("v1 text", "Terms"), admin);
    await expect(
      publishPolicy(getDb(), "terms", { effectiveDate: today() }, owner),
    ).rejects.toThrow(/identical/);

    await savePolicyDraft(getDb(), "terms", draft("v2 text", "Terms (new)"), admin);
    const [live] = await getDb().select().from(policies);
    expect(live).toMatchObject({ bodyMd: "v1 text", title: "Terms", version: 1, published: true });
    expect((await getPolicy(getDb(), "terms"))?.bodyMd).toBe("v1 text");
    expect((await loadPolicyPage(getDb(), "terms", { review: false }))?.html).toContain("v1 text");
    expect(await policiesWithPendingDraft(getDb())).toEqual(["terms"]);
    expect((await listPoliciesAdmin(getDb())).find((p) => p.slug === "terms")).toMatchObject({
      published: true,
      version: 1,
      hasDraft: true,
    });

    editor = await getPolicyEditor(getDb(), "terms");
    expect(editor?.draft).toMatchObject({
      version: 2,
      saved: true,
      bodyMd: "v2 text",
      title: "Terms (new)",
    });
    expect(editor?.history.map((h) => [h.version, h.isLive])).toEqual([[1, true]]);

    await expect(
      publishPolicy(getDb(), "terms", { effectiveDate: "2026-10-15" }, owner),
    ).resolves.toEqual({ version: 2 });
    const [now] = await getDb().select().from(policies);
    expect(now).toMatchObject({
      bodyMd: "v2 text",
      title: "Terms (new)",
      version: 2,
      published: true,
    });
    expect(await getPolicy(getDb(), "terms")).toMatchObject({ version: 2, bodyMd: "v2 text" });
    expect(await policiesWithPendingDraft(getDb())).toEqual([]);

    editor = await getPolicyEditor(getDb(), "terms");
    expect(editor?.history.map((h) => [h.version, h.isLive, h.publishedByName])).toEqual([
      [2, true, "Olivia Owner"],
      [1, false, "Olivia Owner"],
    ]);
    // History rows are immutable once published: later drafts only touch version 3.
    await savePolicyDraft(getDb(), "terms", draft("v3 text", "Terms (newer)"), admin);
    const versions = await getDb().select().from(policyVersions).orderBy(policyVersions.version);
    expect(versions.map((v) => [v.version, v.bodyMd, v.publishedBy ? "pub" : "draft"])).toEqual([
      [1, "v1 text", "pub"],
      [2, "v2 text", "pub"],
      [3, "v3 text", "draft"],
    ]);
  });

  it("restores an earlier version into the draft (only history, never a draft)", async () => {
    await actors();
    await savePolicyDraft(getDb(), "privacy", draft("first", "Privacy"), admin);
    await publishPolicy(getDb(), "privacy", { effectiveDate: "2026-09-01" }, owner);
    await savePolicyDraft(getDb(), "privacy", draft("second", "Privacy"), admin);
    await publishPolicy(getDb(), "privacy", { effectiveDate: "2026-10-10" }, owner);
    await savePolicyDraft(getDb(), "privacy", draft("third draft", "Privacy"), admin);

    await expect(restorePolicyVersion(getDb(), "privacy", 3, admin)).rejects.toThrow(
      /not in the history/,
    );
    await expect(restorePolicyVersion(getDb(), "privacy", 9, admin)).rejects.toThrow(
      /not in the history/,
    );
    await expect(restorePolicyVersion(getDb(), "privacy", 1, fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
    await expect(restorePolicyVersion(getDb(), "privacy", 1, admin)).resolves.toEqual({
      version: 3,
    });
    const editor = await getPolicyEditor(getDb(), "privacy");
    expect(editor?.draft.bodyMd).toBe("first");
    expect((await getDb().select().from(policies))[0]?.bodyMd).toBe("second"); // live untouched
  });

  it("RBAC for editing: admin and owner may edit drafts, fulfilment may not", async () => {
    await actors();
    await expect(savePolicyDraft(getDb(), "shipping", draft("x"), fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
    await expect(
      savePolicyDraft(getDb(), "shipping", draft("x"), { id: "c", role: "customer" }),
    ).rejects.toThrow(/Forbidden/);
    await expect(savePolicyDraft(getDb(), "shipping", draft("x"), admin)).resolves.toBeTruthy();
    await expect(savePolicyDraft(getDb(), "shipping", draft("y"), owner)).resolves.toBeTruthy();
  });

  it("previews with tokens filled and problem spots marked, through the safe renderer", async () => {
    await actors();
    await seedMissingSettings();
    await setSetting("brand_name", "IfOnli", owner.id);
    const { html, problems } = await previewPolicyBody(
      getDb(),
      "# T\n\nHi {{settings.brand_name}} <script>alert(1)</script> {{settings.legal_name}} {{settings.nope}}",
    );
    expect(html).toContain("IfOnli");
    expect(html).not.toContain("<script>");
    expect(html).toContain('data-marker="placeholder"');
    expect(html).toContain('data-marker="unresolved"');
    expect(problems.map((p) => p.kind).sort()).toEqual(["placeholder", "unresolved"]);
    await getDb().delete(settings);
  });
});
