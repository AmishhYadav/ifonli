/**
 * Normalises CSP violation reports into small, PII-free summaries for logging. Handles both wire formats:
 * the legacy `report-uri` body (`{ "csp-report": {...} }`, application/csp-report) and the Reporting API
 * (`report-to`, application/reports+json: an array of `{ type: "csp-violation", body: {...} }`).
 * URLs are cut to origin + path: query strings and fragments (order tokens, search terms) are dropped.
 */

export interface CspViolationSummary {
  /** Violated directive, e.g. "script-src-elem". */
  directive: string;
  /** Blocked resource: origin + path, or a keyword such as "inline" / "eval" / "data". */
  blocked: string;
  /** Page the violation happened on (path only). */
  page: string;
  /** Script that triggered it (origin + path), if reported. */
  source: string;
  line: number | null;
  disposition: "enforce" | "report";
}

const MAX_REPORTS = 10;

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** `https://host/path?x#y` -> `https://host/path`; non-URLs (keywords) pass through trimmed. */
export function stripUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname}`.slice(0, 200);
    }
    return url.protocol.replace(":", ""); // data:, blob:, ...
  } catch {
    return value.slice(0, 40);
  }
}

function pathOf(value: string): string {
  try {
    return new URL(value).pathname.slice(0, 120);
  } catch {
    return value.slice(0, 120);
  }
}

function fromRecord(rec: Record<string, unknown>): CspViolationSummary | null {
  const directive = str(
    rec["effectiveDirective"] ??
      rec["effective-directive"] ??
      rec["violatedDirective"] ??
      rec["violated-directive"],
    60,
  );
  if (!directive) return null;
  const line = Number(rec["lineNumber"] ?? rec["line-number"]);
  return {
    directive: directive.split(" ")[0] ?? directive,
    blocked:
      stripUrl(str(rec["blockedURL"] ?? rec["blocked-uri"] ?? rec["blockedUri"], 400)) || "inline",
    page: pathOf(str(rec["documentURL"] ?? rec["document-uri"] ?? rec["documentUri"], 400)),
    source: stripUrl(str(rec["sourceFile"] ?? rec["source-file"], 400)),
    line: Number.isFinite(line) && line > 0 ? line : null,
    disposition: str(rec["disposition"], 10) === "report" ? "report" : "enforce",
  };
}

export function summariseCspReports(payload: unknown): CspViolationSummary[] {
  const out: CspViolationSummary[] = [];
  const push = (value: unknown) => {
    if (out.length >= MAX_REPORTS || !value || typeof value !== "object") return;
    const summary = fromRecord(value as Record<string, unknown>);
    if (summary) out.push(summary);
  };
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>)["type"] === "csp-violation"
      ) {
        push((item as Record<string, unknown>)["body"]);
      }
    }
  } else if (payload && typeof payload === "object") {
    push((payload as Record<string, unknown>)["csp-report"]);
  }
  return out;
}
