import { formatINR } from "@/lib/money";
import { customerStatusLabel, type FulfillmentStatus } from "@/server/domain/order-state";
import type { SettingFormat } from "@/server/services/settings-registry";

/**
 * Policy / FAQ template renderer (content/README.md). Pure: runs on the Markdown source BEFORE it is
 * converted to HTML. Supports `{{settings.path}}` variables and non-nesting `{{#if}}…{{else}}…{{/if}}`
 * blocks, and nothing else.
 *
 * It never throws. Anything that stops a page from being publishable (unresolved path, a value that is
 * still the registry placeholder, bad syntax) is returned in `problems`; in `preview` mode the offending
 * spot is also marked in the output so the owner can see it.
 */

/** One setting as the renderer sees it. The context is keyed by the registry key (`policy.processors`). */
export interface TemplateSetting {
  value: unknown;
  format?: SettingFormat;
  /** Still a placeholder AND required for launch: publishing must wait for the owner to fill it in. */
  blocking: boolean;
}
export type TemplateContext = Readonly<Record<string, TemplateSetting>>;

export type TemplateProblemKind = "unresolved" | "placeholder" | "syntax" | "unsupported";
export interface TemplateProblem {
  kind: TemplateProblemKind;
  /** The tag as written, without braces (`settings.policy.processors`, `#if foo`). */
  token: string;
  message: string;
}

export interface RenderOptions {
  /** Mark problems in the output (see `MARK_*`). Off in production, where a page with problems is not shown. */
  preview?: boolean;
}
export interface RenderResult {
  text: string;
  /** Unique by kind + token, in order of first appearance. */
  problems: TemplateProblem[];
}

/**
 * Preview markers are wrapped in private-use characters that survive Markdown conversion untouched;
 * `markdown.ts` turns them into <mark> elements. Values never contain them (see `clean`).
 */
export const MARK_START = "";
export const MARK_KIND_END = "";
export const MARK_END = "";
const SENTINELS = /[-]/g;

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const clean = (value: string) => value.replace(SENTINELS, "");
export const escapeText = (value: string) => clean(value).replace(/[&<>"']/g, (c) => escapeMap[c] ?? c);

const mark = (kind: "placeholder" | "unresolved", inner: string) =>
  `${MARK_START}${kind}${MARK_KIND_END}${inner}${MARK_END}`;

const TAG = /\{\{([^{}]*)\}\}/g;
const PATH = /^settings\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;
const COMPARE = /^(settings\.[A-Za-z0-9_.]+)\s*(==|!=)\s*"([^"]*)"$/;
const PLACEHOLDER_TEXT = /^\s*PLACEHOLDER\b/;

/** Customer-facing label of a fulfilment status: the same map the order page uses. */
export function fulfillmentStatusLabel(status: string): string {
  return customerStatusLabel({
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: status as FulfillmentStatus,
  });
}

/** `{minDays, maxDays}` (delivery estimate) -> "3 to 5 days". */
function estimateLabel(v: { minDays: number; maxDays: number }): string {
  const unit = (n: number) => (n === 1 ? "day" : "days");
  return v.minDays === v.maxDays
    ? `${v.minDays} ${unit(v.maxDays)}`
    : `${v.minDays} to ${v.maxDays} ${unit(v.maxDays)}`;
}

function isEstimate(v: unknown): v is { minDays: number; maxDays: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { minDays?: unknown }).minDays === "number" &&
    typeof (v as { maxDays?: unknown }).maxDays === "number"
  );
}

interface Resolved {
  setting: TemplateSetting | null;
  /** Remaining path walked into the value; `undefined` when something along it is missing. */
  value: unknown;
  /** Walked into the setting (`grievance_officer.email`): its format does not apply to the part. */
  nested: boolean;
}

/** Longest registry key that prefixes the path (`grievance_officer` for `grievance_officer.email`). */
function resolve(ctx: TemplateContext, path: string): Resolved {
  const parts = path.split(".");
  for (let i = parts.length; i >= 1; i--) {
    const key = parts.slice(0, i).join(".");
    if (!Object.hasOwn(ctx, key)) continue;
    const setting = ctx[key] as TemplateSetting;
    let value: unknown = setting.value;
    for (const part of parts.slice(i)) {
      value =
        typeof value === "object" && value !== null && Object.hasOwn(value, part)
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    return { setting, value, nested: i < parts.length };
  }
  return { setting: null, value: undefined, nested: false };
}

/** README truthiness: false for missing, null, false, 0, "", empty array, empty object. */
export function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "") {
    return false;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

type Piece =
  | { type: "text"; text: string }
  | { type: "var"; inner: string }
  | { type: "if" | "else" | "endif"; inner: string }
  | { type: "bad"; inner: string };

/**
 * Splits the source into text and tags. A conditional tag that is alone on its line takes the whole
 * line (leading blanks, trailing blanks and the newline) with it.
 */
function tokenize(source: string): Piece[] {
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const m of source.matchAll(TAG)) {
    const inner = (m[1] ?? "").trim();
    const start = m.index;
    let end = start + m[0].length;
    let textEnd = start;

    let type: Piece["type"];
    if (/^#if(\s|$)/.test(inner)) type = "if";
    else if (inner === "else") type = "else";
    else if (inner === "/if") type = "endif";
    else if (inner.startsWith("#") || inner.startsWith("/")) type = "bad";
    else type = "var";

    if (type === "if" || type === "else" || type === "endif") {
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const nl = source.indexOf("\n", end);
      const lineEnd = nl === -1 ? source.length : nl;
      if (/^[ \t]*$/.test(source.slice(lineStart, start)) && /^[ \t\r]*$/.test(source.slice(end, lineEnd))) {
        textEnd = lineStart;
        end = nl === -1 ? source.length : nl + 1;
      }
    }

    if (textEnd > cursor) pieces.push({ type: "text", text: source.slice(cursor, textEnd) });
    pieces.push({ type, inner });
    cursor = end;
  }
  if (cursor < source.length) pieces.push({ type: "text", text: source.slice(cursor) });
  return pieces;
}

interface Block {
  /** The `{{else}}` was seen. */
  inElse: boolean;
  cond: boolean;
}

export function renderTemplate(source: string, ctx: TemplateContext, options: RenderOptions = {}): RenderResult {
  const preview = options.preview === true;
  const problems: TemplateProblem[] = [];
  const seen = new Set<string>();
  const out: string[] = [];

  const report = (kind: TemplateProblemKind, token: string, message: string) => {
    const id = `${kind}:${token}`;
    if (seen.has(id)) return;
    seen.add(id);
    problems.push({ kind, token, message });
  };

  /** Value of a variable tag as text, or null when it cannot be printed. */
  const printValue = (r: Resolved, token: string): string | null => {
    const { setting, value } = r;
    if (!setting || value === undefined || value === null) return null;
    const format = r.nested ? undefined : setting.format;
    if (Array.isArray(value)) {
      const items = value.map((item) => String(item));
      const labelled = format === "fulfillment_statuses" ? [...new Set(items.map(fulfillmentStatusLabel))] : items;
      return escapeText(labelled.join(", "));
    }
    if (typeof value === "object") {
      if (isEstimate(value)) return escapeText(estimateLabel(value));
      report("unsupported", token, `"${token}" is an object and can only be used in a condition`);
      return null;
    }
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") {
      return format === "money" ? escapeText(formatINR(value)) : escapeText(String(value));
    }
    const text = String(value);
    return format === "md" && !r.nested ? clean(text) : escapeText(text);
  };

  const variable = (inner: string): string => {
    const match = PATH.exec(inner);
    if (!match) {
      report("syntax", inner, `"{{${inner}}}" is not a valid tag; variables look like {{settings.some.key}}`);
      return preview ? mark("unresolved", escapeText(`{{${inner}}}`)) : "";
    }
    const r = resolve(ctx, match[1] as string);
    const text = printValue(r, inner);
    if (text === null) {
      if (!r.setting || r.value === undefined || r.value === null) {
        report("unresolved", inner, `"${inner}" has no value`);
      }
      return preview ? mark("unresolved", escapeText(`{{${inner}}}`)) : "";
    }
    const placeholder =
      r.setting?.blocking === true || (typeof r.value === "string" && PLACEHOLDER_TEXT.test(r.value));
    if (placeholder) {
      report("placeholder", inner, `"${inner}" is still a placeholder`);
      return preview ? mark("placeholder", text) : text;
    }
    return text;
  };

  const condition = (inner: string): boolean => {
    const expr = inner.replace(/^#if\s*/, "").trim();
    const compare = COMPARE.exec(expr);
    const target = compare ? (compare[1] as string) : expr;
    const path = PATH.exec(target)?.[1];
    if (!path) {
      report("syntax", inner, `"{{${inner}}}" is not a valid condition`);
      return false;
    }
    const r = resolve(ctx, path);
    if (!r.setting) {
      report("unresolved", target, `"${target}" is not a known setting`);
      return false;
    }
    if (r.setting.blocking) report("placeholder", target, `"${target}" is still a placeholder`);
    if (!compare) return isTruthy(r.value);
    const literal = compare[3] as string;
    const equal =
      typeof r.value === "string" || typeof r.value === "number" || typeof r.value === "boolean"
        ? String(r.value) === literal
        : false;
    return compare[2] === "==" ? equal : !equal;
  };

  let block: Block | null = null;
  let nested = 0;
  for (const piece of tokenize(source)) {
    const visible = block === null || (block.inElse ? !block.cond : block.cond);
    switch (piece.type) {
      case "text":
        if (visible) out.push(piece.text);
        break;
      case "var":
        if (visible) out.push(variable(piece.inner));
        break;
      case "if":
        if (block) {
          nested++;
          report("syntax", piece.inner, "Conditional blocks cannot be nested");
        } else {
          block = { inElse: false, cond: condition(piece.inner) };
        }
        break;
      case "else":
        if (nested > 0) break;
        if (!block) report("syntax", "else", "{{else}} without a matching {{#if}}");
        else if (block.inElse) report("syntax", "else", "A {{#if}} block has more than one {{else}}");
        else block.inElse = true;
        break;
      case "endif":
        if (nested > 0) nested--;
        else if (!block) report("syntax", "/if", "{{/if}} without a matching {{#if}}");
        else block = null;
        break;
      case "bad":
        report("syntax", piece.inner, `"{{${piece.inner}}}" is not supported`);
        break;
    }
  }
  if (block) report("syntax", "#if", "A {{#if}} block is never closed");

  return { text: out.join(""), problems };
}
