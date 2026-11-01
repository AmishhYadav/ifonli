import { expect, test } from "@playwright/test";

import { cleanupQaAdmins, createAdminSession, type AdminLogin } from "../support/admin";
import { sql } from "../support/db";

/**
 * Admin pincodes screen and inventory CSV import, signed in as an owner against the dev stack.
 * Skipped unless E2E_ADMIN_FLOW=1. Every flag and stock figure it changes is put back afterwards
 * (stock through a second import, so the ledger still adds up).
 *
 *   E2E_ADMIN_FLOW=1 E2E_BASE_URL=http://localhost:3103 pnpm e2e tests/e2e/admin-pincodes-inventory.spec.ts --project=chromium-desktop
 */
test.skip(!process.env.E2E_ADMIN_FLOW, "set E2E_ADMIN_FLOW=1 (needs the dev database)");
test.describe.configure({ mode: "serial" });

let admin: AdminLogin;
type Flags = { pincode: string; serviceable: boolean; cod_allowed: boolean };
let islandsBefore: Flags[] = [];
let stockBefore: { sku: string; stock_on_hand: number } | null = null;

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  islandsBefore = await sql<Flags[]>`
    select pincode, serviceable, cod_allowed from pincodes where zone = 'islands' order by pincode`;
  const [v] = await sql<{ sku: string; stock_on_hand: number }[]>`
    select v.sku, v.stock_on_hand from variants v join products p on p.id = v.product_id
    where p.status <> 'archived' order by v.sku limit 1`;
  stockBefore = v ?? null;
  admin = await createAdminSession(browser, baseURL!, "owner");
});

test.afterAll(async () => {
  for (const r of islandsBefore) {
    await sql`update pincodes set serviceable = ${r.serviceable}, cod_allowed = ${r.cod_allowed} where pincode = ${r.pincode}`;
  }
  await cleanupQaAdmins(admin ? [admin.email] : []);
});

test("pincodes: search, toggle one, bulk with a counted confirm, CSV preview and apply", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: admin.storageState });
  const page = await context.newPage();
  const target = islandsBefore.find((r) => r.serviceable && r.cod_allowed) ?? islandsBefore[0]!;

  await page.goto("/admin/pincodes?zone=islands");
  await expect(page.getByRole("heading", { level: 1, name: "Pincodes" })).toBeVisible();
  await expect(page.getByText(/refused at checkout/).first()).toBeVisible();

  // Search by pincode.
  await page.goto(`/admin/pincodes?q=${target.pincode}`);
  await expect(page.getByTestId("pincode-row")).toHaveCount(1);

  // Toggle serviceable off: persisted and audited.
  await page.getByRole("switch", { name: `Serviceable: ${target.pincode}` }).click();
  await expect(page.getByText(`${target.pincode}: no longer serviceable`)).toBeVisible();
  await expect
    .poll(async () => (await sql`select serviceable from pincodes where pincode = ${target.pincode}`)[0]!.serviceable)
    .toBe(false);
  const [audit] = await sql`select diff from admin_audit_log where action = 'pincode.update' and entity_id = ${target.pincode} order by created_at desc limit 1`;
  expect(audit!.diff).toEqual({ serviceable: { from: true, to: false } });

  // Bulk on the islands zone: the confirm states the count.
  await page.goto("/admin/pincodes?zone=islands");
  await page.getByRole("button", { name: "Review change…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(/will change/);
  await expect(dialog).toContainText(/zone Islands/);
  await dialog.getByRole("button", { name: /^Mark not serviceable: \d/ }).click();
  await expect(page.getByText(/pincodes? updated/)).toBeVisible();
  await expect
    .poll(async () => (await sql`select count(*)::int c from pincodes where zone = 'islands' and serviceable`)[0]!.c)
    .toBe(0);
  const bulk = await sql`select diff from admin_audit_log where action = 'pincode.bulk_update' order by created_at desc limit 1`;
  expect(bulk[0]!.diff).toMatchObject({ filter: { zone: "islands" }, set: { serviceable: false } });

  // CSV: one valid line, one unknown pincode, one bad value; nothing can be applied yet.
  await page.goto("/admin/pincodes");
  await page.waitForLoadState("networkidle"); // hydrated: a file chosen earlier would be ignored
  const [free] = await sql<{ unknown: string }[]>`
    select ('1' || lpad(g::text, 5, '0')) as unknown from generate_series(0, 500) g
    where not exists (select 1 from pincodes where pincode = '1' || lpad(g::text, 5, '0')) limit 1`;
  const unknown = free!.unknown;
  const other = islandsBefore.find((r) => r.pincode !== target.pincode)!.pincode;
  const csv = `pincode,serviceable,cod_allowed\n${target.pincode},yes,\n${unknown},no,\n${other},maybe,\n`;
  await page.locator("#pincode-csv").setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const preview = page.getByTestId("pincode-csv-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("pincode-csv-issue")).toHaveCount(2);
  await expect(preview.getByRole("button", { name: /^Apply/ })).toBeDisabled();

  // A clean file applies.
  const clean = `pincode,serviceable,cod_allowed\n${target.pincode},yes,\n`;
  await page.locator("#pincode-csv").setInputFiles({ name: "clean.csv", mimeType: "text/csv", buffer: Buffer.from(clean) });
  await expect(preview).toContainText("1 would change");
  await preview.getByRole("button", { name: /^Apply 1 change/ }).click();
  await expect(page.getByText("1 pincodes updated")).toBeVisible();
  await expect
    .poll(async () => (await sql`select serviceable from pincodes where pincode = ${target.pincode}`)[0]!.serviceable)
    .toBe(true);

  // The export has the import columns.
  const res = await page.request.get("/admin/pincodes/export?zone=islands");
  expect(res.status()).toBe(200);
  expect((await res.text()).split("\r\n")[0]).toBe("pincode,serviceable,cod_allowed,district,state,zone");
  await context.close();
});

test("inventory: upload a CSV, see old to new, apply, then put it back", async ({ browser, baseURL }) => {
  test.skip(!stockBefore, "no variants in the dev database");
  const { sku, stock_on_hand: before } = stockBefore!;
  const context = await browser.newContext({ baseURL, storageState: admin.storageState });
  const page = await context.newPage();
  await page.goto("/admin/inventory");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Import stock from a CSV" })).toBeVisible();

  // A problem file cannot be applied.
  await page.locator("#inventory-csv").setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`SKU,On hand\n${sku},${before + 3}\nNOPE-123,4\n${sku}x,-1\n`),
  });
  const preview = page.getByTestId("inventory-import-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("inventory-import-issue")).toHaveCount(2);
  await expect(preview.getByRole("button", { name: /^Apply/ })).toBeDisabled();

  // A clean file shows now and new, and applies.
  await page.locator("#inventory-csv").setInputFiles({
    name: "ok.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`SKU,On hand\n${sku},${before + 3}\n`),
  });
  await expect(preview).toContainText("1 would change");
  await expect(preview.getByRole("cell", { name: String(before + 3), exact: true })).toBeVisible();
  await preview.getByRole("button", { name: /^Apply 1 change/ }).click();
  await expect(page.getByText(/Stock updated for 1 variant/)).toBeVisible();
  const [after] = await sql<{ stock_on_hand: number }[]>`select stock_on_hand from variants where sku = ${sku}`;
  expect(after!.stock_on_hand).toBe(before + 3);
  const [move] = await sql<{ delta: number; reason: string; note: string }[]>`
    select m.delta, m.reason, m.note from inventory_movements m join variants v on v.id = m.variant_id
    where v.sku = ${sku} order by m.created_at desc limit 1`;
  expect(move).toMatchObject({ delta: 3, reason: "adjust" });
  expect(move!.note).toContain("CSV import ok.csv");

  // Put it back through the same screen so the ledger still adds up.
  await page.locator("#inventory-csv").setInputFiles({
    name: "restore.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`SKU,On hand\n${sku},${before}\n`),
  });
  await preview.getByRole("button", { name: /^Apply 1 change/ }).click();
  await expect(page.getByText(/Stock updated for 1 variant/)).toBeVisible();
  await expect
    .poll(async () => (await sql`select stock_on_hand from variants where sku = ${sku}`)[0]!.stock_on_hand)
    .toBe(before);
  await context.close();
});
