import { describe, expect, it } from "vitest";

import { parseCsv } from "@/server/services/reference";

describe("parseCsv", () => {
  it("parses plain, quoted, escaped-quote and CRLF rows", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y",3\r\n"he said ""hi""",,\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", "3"],
      ['he said "hi"', "", ""],
    ]);
  });
  it("ignores blank lines and handles a missing trailing newline", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
