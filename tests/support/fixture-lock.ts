import postgres from "postgres";

/**
 * Specs that rewrite shared dev-database rows (commerce settings, the test pincodes and stock, the
 * qa- fixtures) must not overlap: one spec's restore would undo another's setup halfway through, and
 * its cleanup would delete the other's orders and accounts. Each such spec holds this Postgres
 * advisory lock from the start of its `beforeAll` to the end of its `afterAll`, so they queue across
 * workers. The lock lives on a connection of its own and is released by Postgres if the worker dies.
 */
const LOCK_KEY = 4_260_001;
let holder: postgres.Sql | null = null;

export async function acquireFixtureLock(): Promise<void> {
  if (holder) return;
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const connection = postgres(url, { max: 1, onnotice: () => {} });
  await connection`select pg_advisory_lock(${LOCK_KEY})`;
  holder = connection;
}

export async function releaseFixtureLock(): Promise<void> {
  const connection = holder;
  holder = null;
  if (!connection) return;
  try {
    await connection`select pg_advisory_unlock(${LOCK_KEY})`;
  } finally {
    await connection.end();
  }
}
