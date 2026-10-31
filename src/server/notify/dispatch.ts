import "server-only";

import { after } from "next/server";

import { getDb } from "@/server/db";

import { processOutbox } from "./sender";

/**
 * Sends whatever is due in the outbox right after the current request has responded (plan 7.10: the
 * sender runs right after commit). Call it from a route handler or server action AFTER the transaction
 * that wrote the outbox rows has committed. Failures are logged and left to the `notify-retry` cron,
 * which is the backstop either way. Outside a request scope (scripts) it runs immediately instead.
 */
export function dispatchOutboxSoon(): void {
  const run = async () => {
    try {
      await processOutbox(getDb(), { limit: 25 });
    } catch (e) {
      console.error("outbox dispatch failed:", e instanceof Error ? e.name : "unknown");
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
