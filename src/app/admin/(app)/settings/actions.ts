"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateSettings } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  SettingAdminValidationError,
  updateSettingAdmin,
  type SettingIssue,
} from "@/server/services/admin/settings";

export type SaveSettingResult =
  | { saved: true; changed: boolean }
  | { saved: false; issues: SettingIssue[] };

/** Saves one setting (owner only). Validation problems come back as `issues` so the form can show them per field. */
export async function updateSettingAction(
  key: string,
  value: unknown,
): Promise<ActionResult<SaveSettingResult>> {
  return runAdminAction("setting:update", async ({ actor }): Promise<SaveSettingResult> => {
    try {
      const out = await updateSettingAdmin(getDb(), z.string().max(80).parse(key), value, actor);
      // Settings leak into cached output (footer, policies, FAQ answers, PDP legal block, vibe cycle).
      revalidateSettings();
      return { saved: true, changed: out.changed };
    } catch (error) {
      if (error instanceof SettingAdminValidationError) return { saved: false, issues: error.issues };
      throw error;
    }
  });
}
