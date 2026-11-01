"use server";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { getDb } from "@/server/db";
import {
  applyPincodeCsv,
  bulkUpdatePincodes,
  previewBulkPincodes,
  previewPincodeCsv,
  setPincodeFlags,
  type BulkPreview,
  type BulkResult,
  type PincodeCsvPreview,
  type PincodeCsvResult,
  type PincodeFlagsResult,
} from "@/server/services/admin/pincodes";

// No cache revalidation anywhere in this file: checkout, the PDP delivery check and order tracking
// read the pincode flags straight from the database on every request (see the service's doc).

/** Turns serviceable and/or COD on or off for one pincode. */
export async function setPincodeFlagsAction(input: unknown): Promise<ActionResult<PincodeFlagsResult>> {
  return runAdminAction("setting:update", ({ actor }) => setPincodeFlags(getDb(), input, actor));
}

/** How many pincodes a bulk action matches and would change (for the confirmation dialog). */
export async function previewBulkPincodesAction(input: unknown): Promise<ActionResult<BulkPreview>> {
  return runAdminAction("setting:update", ({ actor }) => previewBulkPincodes(getDb(), input, actor));
}

/** Applies a flag to every pincode matching the filter. */
export async function bulkUpdatePincodesAction(input: unknown): Promise<ActionResult<BulkResult>> {
  return runAdminAction("setting:update", ({ actor }) => bulkUpdatePincodes(getDb(), input, actor));
}

/** Dry run of an uploaded CSV (text read in the browser). Writes nothing. */
export async function previewPincodeCsvAction(text: unknown): Promise<ActionResult<PincodeCsvPreview>> {
  return runAdminAction("setting:update", ({ actor }) => previewPincodeCsv(getDb(), text, actor));
}

/** Applies an uploaded CSV in one transaction (refused if any line has a problem). */
export async function applyPincodeCsvAction(input: unknown): Promise<ActionResult<PincodeCsvResult>> {
  return runAdminAction("setting:update", ({ actor }) => applyPincodeCsv(getDb(), input, actor));
}
