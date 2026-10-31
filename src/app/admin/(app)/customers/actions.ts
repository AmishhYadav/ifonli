"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { getDb } from "@/server/db";
import {
  deleteCustomerForStaff,
  exportCustomerForStaff,
  type CustomerExportFile,
} from "@/server/services/admin/customers";

const refSchema = z.string().min(1).max(100);

/** DPDP access request: the customer's data as a JSON file. Audited (`customer.export`). */
export async function exportCustomerAction(ref: string): Promise<ActionResult<CustomerExportFile>> {
  return runAdminAction("customer:export", async ({ actor }) =>
    exportCustomerForStaff(getDb(), refSchema.parse(ref), actor),
  );
}

/** DPDP erasure request: deletes the account after the typed confirmation. Audited (`customer.delete`). */
export async function deleteCustomerAction(
  ref: string,
  input: unknown,
): Promise<ActionResult<{ ordersRetained: number }>> {
  return runAdminAction("customer:delete", async ({ actor }) =>
    deleteCustomerForStaff(getDb(), refSchema.parse(ref), input, actor),
  );
}
