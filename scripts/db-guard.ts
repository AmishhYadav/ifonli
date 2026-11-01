/**
 * Safety check shared by the seed and admin scripts. These run under `tsx`, where `NODE_ENV` is
 * normally unset, so it says nothing about which database a script is pointed at. The host in
 * DATABASE_URL does: anything other than this machine is treated as a real environment and needs
 * `--allow-remote` on the command line.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The host of DATABASE_URL, or null when it is missing or unparsable. */
export function databaseHost(url: string | undefined = process.env.DATABASE_URL): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

export function isLocalDatabase(url?: string): boolean {
  const host = databaseHost(url);
  return host !== null && LOCAL_HOSTS.has(host);
}

/**
 * Exits with an explanation unless the database is local or `--allow-remote` was passed.
 * `what` completes "<script> would <what>".
 */
export function requireLocalOrAllowRemote(script: string, what: string, argv: readonly string[] = process.argv): void {
  if (isLocalDatabase() || argv.includes("--allow-remote")) return;
  const host = databaseHost() ?? "(DATABASE_URL is not set or not a valid URL)";
  console.error(
    `${script}: refusing to run. It would ${what} on database host "${host}", which is not this machine.\n` +
      "If that is really the intended database, run it again with --allow-remote.",
  );
  process.exit(1);
}
