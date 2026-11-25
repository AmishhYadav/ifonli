/**
 * Optional admin IP allow-list (`ADMIN_ALLOWED_IPS`): pure parsing and matching, no Next imports, no
 * Node APIs, so it runs in the proxy, in `env.ts` and in unit tests alike.
 *
 * Accepted entries (comma-separated, whitespace ignored): IPv4 addresses (`203.0.113.7`), IPv4 CIDR
 * ranges (`203.0.113.0/24`, prefix 1 to 32) and IPv6 addresses (`2001:db8::1`; no IPv6 ranges).
 * An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is treated as the IPv4 address it wraps, on
 * both sides of the comparison. Anything else is reported as invalid; callers refuse a list with
 * any invalid entry rather than guess (a half-understood allow-list must not silently open or
 * close the admin).
 */

type ParsedIp = { v: 4; n: number } | { v: 6; w: number[] };

/** A parsed allow-list entry. */
export type IpRule = { v: 4; base: number; mask: number } | { v: 6; w: number[] };

export interface ParsedAllowList {
  rules: IpRule[];
  /** Entries that are not an address or CIDR we understand, verbatim (they are not secrets). */
  invalid: string[];
}

function parseIPv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    // Plain decimal only: leading zeros are ambiguous (some parsers read them as octal).
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

function parseIPv6(text: string): number[] | null {
  if (text.length === 0 || text.length > 45 || /[^0-9a-fA-F:.]/.test(text)) return null;
  // A dotted IPv4 tail (`::ffff:1.2.3.4`) stands for the last two groups.
  let head = text;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    head = text.slice(0, lastColon + 1);
    // `::1.2.3.4` leaves "::" and `a:b::1.2.3.4` leaves "a:b::"; `a:b:c:1.2.3.4` leaves "a:b:c:".
    if (!head.endsWith("::")) head = head.slice(0, -1);
  }
  const groupsOf = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = groupsOf(halves[0]!);
  if (left === null) return null;
  if (halves.length === 1) {
    const words = [...left, ...tail];
    return words.length === 8 ? words : null;
  }
  const right = groupsOf(halves[1]!);
  if (right === null) return null;
  const missing = 8 - left.length - right.length - tail.length;
  if (missing < 1) return null; // "::" must stand for at least one group
  return [...left, ...Array<number>(missing).fill(0), ...right, ...tail];
}

/** Folds an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) into plain IPv4. */
function fromWords(w: number[]): ParsedIp {
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    return { v: 4, n: w[6]! * 65536 + w[7]! };
  }
  return { v: 6, w };
}

function parseIp(text: string): ParsedIp | null {
  const t = text.trim();
  if (t.includes(":")) {
    const w = parseIPv6(t);
    return w ? fromWords(w) : null;
  }
  const n = parseIPv4(t);
  return n === null ? null : { v: 4, n };
}

function parseRule(entry: string): IpRule | null {
  const slash = entry.indexOf("/");
  if (slash === -1) {
    const ip = parseIp(entry);
    return ip?.v === 4 ? { v: 4, base: ip.n, mask: 0xffffffff } : ip;
  }
  const addr = parseIPv4(entry.slice(0, slash));
  const prefixText = entry.slice(slash + 1);
  if (addr === null || !/^\d{1,2}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  // /0 would allow the whole internet: that is "no allow-list", and almost certainly a typo.
  if (prefix < 1 || prefix > 32) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return { v: 4, base: (addr & mask) >>> 0, mask };
}

/** Parses the comma-separated `ADMIN_ALLOWED_IPS` value. */
export function parseAllowedIps(raw: string): ParsedAllowList {
  const rules: IpRule[] = [];
  const invalid: string[] = [];
  for (const entry of raw.split(",").map((e) => e.trim())) {
    if (entry === "") continue;
    const rule = parseRule(entry);
    if (rule) rules.push(rule);
    else invalid.push(entry);
  }
  return { rules, invalid };
}

/** Whether `ip` (as found in a header) is covered by a rule. Unparseable or missing addresses are not allowed. */
export function isIpAllowed(ip: string | null | undefined, rules: readonly IpRule[]): boolean {
  if (!ip) return false;
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return rules.some((rule) => {
    if (rule.v === 4) return parsed.v === 4 && ((parsed.n & rule.mask) >>> 0) === rule.base;
    return parsed.v === 6 && parsed.w.every((word, i) => word === rule.w[i]);
  });
}

/**
 * The client address from request headers: first entry of `x-forwarded-for`, else `x-real-ip`.
 * On Vercel the platform overwrites `x-forwarded-for` with the connecting client's address (a
 * client-supplied value is never forwarded), so the first entry can be trusted there. Behind any
 * other proxy that appends to a client-supplied header this would NOT hold; do not rely on the
 * allow-list outside Vercel without checking how the proxy treats the header.
 */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}
