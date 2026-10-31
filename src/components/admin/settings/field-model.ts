import { z } from "zod";

import { VIBES, VIBE_NAMES } from "@/features/vibe/config";
import { SETTINGS, type SettingKey } from "@/server/services/settings-registry";

/**
 * Form model generated from the settings registry. Each key's Zod schema is converted to JSON Schema and
 * then to a small tree of field nodes (text, number, money, switch, select, choices, lines, object, record),
 * so a new registry key gets a typed form without any UI code. The tree also knows how to turn a stored
 * value into form state (`toDraft`) and back (`fromDraft`, including rupees -> paise). The server still
 * validates the final value with the real Zod schema.
 */

export interface Option {
  value: string;
  label: string;
}

export type Node =
  | { kind: "text"; multiline: boolean; email: boolean }
  | { kind: "number"; integer: boolean; money: boolean; min: number | null; max: number | null }
  | { kind: "boolean" }
  | { kind: "enum"; options: Option[] }
  /** Array of known values (checkboxes); `ordered` adds up / down buttons and keeps the order. */
  | { kind: "choices"; options: Option[]; ordered: boolean }
  /** Array of free text (one per line). */
  | { kind: "lines"; email: boolean }
  | { kind: "object"; fields: { key: string; label: string; node: Node }[] }
  /** Optional value per known key (zones); a blank row is left out. */
  | { kind: "record"; keys: Option[]; value: Node }
  | { kind: "nullable"; inner: Node };

export type Draft = string | boolean | string[] | { [key: string]: Draft | undefined };

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: JsonSchema | boolean;
  propertyNames?: JsonSchema;
  format?: string;
  minimum?: number;
  maximum?: number;
}

interface Hint {
  multiline?: boolean;
  money?: boolean;
  options?: Option[];
  ordered?: boolean;
}

const VIBE_OPTIONS: Option[] = VIBES.map((v) => ({ value: v, label: VIBE_NAMES[v] }));

/** Things the Zod schema cannot say: which strings are really a pick-list, which maps hold money, long text. */
const HINTS: Partial<Record<SettingKey, Hint>> = {
  vibe_cycle: { options: VIBE_OPTIONS, ordered: true },
  default_vibe: { options: [...VIBE_OPTIONS, { value: "random", label: "Random" }] },
  zone_overrides: { money: true },
  registered_address: { multiline: true },
  delay_message: { multiline: true },
};

const ACRONYMS: Record<string, string> = {
  cod: "COD",
  gst: "GST",
  rto: "RTO",
  gstin: "GSTIN",
  ga4: "GA4",
  bp: "bp",
  md: "Markdown",
  jk: "J&K",
};

const FIELD_LABELS: Record<string, string> = {
  minDays: "Fastest (days)",
  maxDays: "Slowest (days)",
  jk_ladakh: "J&K and Ladakh",
  north_east: "North-east",
  metro_region: "Metro regions",
  rest_of_india: "Rest of India",
  islands: "Islands",
};

/** `order_confirmed` -> `Order confirmed`; `cod` -> `COD`. */
export function humanize(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const toOptions = (values: unknown[]): Option[] =>
  values.map((v) => ({ value: String(v), label: humanize(String(v)) }));

function build(js: JsonSchema, hint: Hint, formatMoney: boolean): Node {
  if (js.anyOf) {
    const rest = js.anyOf.filter((s) => s.type !== "null");
    if (rest.length === 1 && rest.length !== js.anyOf.length) {
      return { kind: "nullable", inner: build(rest[0]!, hint, formatMoney) };
    }
  }
  if (hint.options && js.type === "string") return { kind: "enum", options: hint.options };
  if (hint.options && js.type === "array") {
    return { kind: "choices", options: hint.options, ordered: hint.ordered === true };
  }
  if (js.const !== undefined && typeof js.const === "boolean") return { kind: "boolean" };
  if (js.enum) return { kind: "enum", options: toOptions(js.enum) };
  switch (js.type) {
    case "string":
      return { kind: "text", multiline: hint.multiline === true, email: js.format === "email" };
    case "integer":
    case "number": {
      const bounded = (n: number | undefined) => (n !== undefined && Math.abs(n) < 1e12 ? n : null);
      return {
        kind: "number",
        integer: js.type === "integer",
        money: formatMoney || hint.money === true,
        min: bounded(js.minimum),
        max: bounded(js.maximum),
      };
    }
    case "boolean":
      return { kind: "boolean" };
    case "array": {
      const item = js.items ?? {};
      if (item.enum)
        return { kind: "choices", options: toOptions(item.enum), ordered: hint.ordered === true };
      return { kind: "lines", email: item.format === "email" };
    }
    case "object": {
      if (js.properties) {
        return {
          kind: "object",
          fields: Object.entries(js.properties).map(([key, sub]) => ({
            key,
            label: humanize(key),
            node: build(sub, hint, formatMoney),
          })),
        };
      }
      const keys = js.propertyNames?.enum;
      if (keys && typeof js.additionalProperties === "object") {
        return {
          kind: "record",
          keys: toOptions(keys),
          value: build(js.additionalProperties, hint, formatMoney),
        };
      }
      break;
    }
    default:
      break;
  }
  // Unknown shape: fall back to plain text so the key can at least be edited (the server validates).
  return { kind: "text", multiline: true, email: false };
}

/** The form tree for one registry key. */
export function nodeForSetting(key: SettingKey): Node {
  const def = SETTINGS[key];
  const js = z.toJSONSchema(def.schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  const hint: Hint = { ...HINTS[key] };
  if (def.format === "md") hint.multiline = true;
  return build(js, hint, def.format === "money");
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

/** 4950 -> "49.50"; 4900 -> "49". */
export function paiseToRupees(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const rest = Math.abs(paise % 100);
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, "0")}`;
}

/** "49.5" -> 4950; null when it is not a plain amount with at most two decimals. */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(paise) ? paise : null;
}

// ---------------------------------------------------------------------------------------------
// Value <-> draft
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function toDraft(node: Node, value: unknown): Draft {
  switch (node.kind) {
    case "text":
      return value === null || value === undefined ? "" : String(value);
    case "number":
      return typeof value === "number" ? (node.money ? paiseToRupees(value) : String(value)) : "";
    case "boolean":
      return value === true;
    case "enum":
      return typeof value === "string" ? value : "";
    case "choices":
      return Array.isArray(value) ? value.map(String) : [];
    case "lines":
      return Array.isArray(value) ? value.map(String).join("\n") : "";
    case "nullable":
      return value === null || value === undefined ? "" : toDraft(node.inner, value);
    case "object": {
      const src = isObj(value) ? value : {};
      return Object.fromEntries(node.fields.map((f) => [f.key, toDraft(f.node, src[f.key])]));
    }
    case "record": {
      const src = isObj(value) ? value : {};
      return Object.fromEntries(
        node.keys
          .filter((k) => k.value in src)
          .map((k) => [k.value, toDraft(node.value, src[k.value])]),
      );
    }
  }
}

/** Blank = the person has not filled it in (used to leave optional record rows out). */
export function isBlank(node: Node, draft: Draft | undefined): boolean {
  if (draft === undefined) return true;
  switch (node.kind) {
    case "text":
    case "number":
    case "enum":
    case "lines":
    case "nullable":
      return typeof draft === "string" && draft.trim() === "";
    case "boolean":
      return false;
    case "choices":
      return Array.isArray(draft) && draft.length === 0;
    case "object":
      return (
        isObj(draft) &&
        node.fields.every((f) =>
          isBlank(f.node, (draft as { [k: string]: Draft | undefined })[f.key]),
        )
      );
    case "record":
      return isObj(draft) && Object.keys(draft).length === 0;
  }
}

export interface DraftResult {
  value: unknown;
  /** Local problems by dotted path (`""` = the whole value). Empty means the value can be sent. */
  errors: Record<string, string>;
}

export function fromDraft(node: Node, draft: Draft | undefined, path = ""): DraftResult {
  const errors: Record<string, string> = {};

  function walk(n: Node, d: Draft | undefined, p: string): unknown {
    const sub = (key: string) => (p ? `${p}.${key}` : key);
    switch (n.kind) {
      case "text":
        return typeof d === "string" ? d : "";
      case "enum":
        return typeof d === "string" ? d : "";
      case "boolean":
        return d === true;
      case "choices":
        return Array.isArray(d) ? d : [];
      case "lines":
        return typeof d === "string"
          ? d
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      case "number": {
        const text = typeof d === "string" ? d.trim() : "";
        if (text === "") {
          errors[p] = "Enter a number";
          return undefined;
        }
        if (n.money) {
          const paise = rupeesToPaise(text);
          if (paise === null) {
            errors[p] =
              "Enter an amount in rupees, with at most two decimals (for example 49 or 49.50)";
            return undefined;
          }
          return paise;
        }
        const num = Number(text);
        if (!Number.isFinite(num) || (n.integer && !/^-?\d+$/.test(text))) {
          errors[p] = n.integer ? "Enter a whole number" : "Enter a number";
          return undefined;
        }
        return num;
      }
      case "nullable":
        return typeof d === "string" && d.trim() === "" ? null : walk(n.inner, d, p);
      case "object": {
        const src = isObj(d) ? (d as { [k: string]: Draft | undefined }) : {};
        return Object.fromEntries(
          n.fields.map((f) => [f.key, walk(f.node, src[f.key], sub(f.key))]),
        );
      }
      case "record": {
        const src = isObj(d) ? (d as { [k: string]: Draft | undefined }) : {};
        const out: Obj = {};
        for (const k of n.keys) {
          if (!(k.value in src) || isBlank(n.value, src[k.value])) continue;
          out[k.value] = walk(n.value, src[k.value], sub(k.value));
        }
        return out;
      }
    }
  }
  return { value: walk(node, draft, path), errors };
}

/** Whether two drafts are the same (dirty check). */
export function sameDraft(a: Draft | undefined, b: Draft | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
