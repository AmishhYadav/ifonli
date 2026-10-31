/**
 * Minimal front-matter reader for `content/policies/*.md`: a `---` fenced block of flat `key: value` lines
 * (quoted or bare strings, `null`, integers). No YAML dependency on purpose; anything fancier is rejected.
 */

export interface ParsedDocument {
  data: Record<string, string | number | null>;
  body: string;
}

function parseScalar(raw: string): string | number | null {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

export function parseFrontMatter(source: string): ParsedDocument {
  const text = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) throw new Error("Missing front matter (expected a leading --- block)");
  const data: ParsedDocument["data"] = {};
  for (const line of (match[1] ?? "").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`Unsupported front matter line: ${line}`);
    data[line.slice(0, colon).trim()] = parseScalar(line.slice(colon + 1));
  }
  return { data, body: text.slice(match[0].length).replace(/^\n+/, "") };
}
