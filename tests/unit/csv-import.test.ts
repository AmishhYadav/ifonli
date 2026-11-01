import { describe, expect, it } from "vitest";

import { parseCsv, parseYesNo } from "@/lib/csv";
import { parseInventoryCsv } from "@/server/services/admin/inventory-import";
import { parsePincodeCsv, pincodesCsv } from "@/server/services/admin/pincodes";

describe("parseCsv", () => {
  it("handles CRLF, a BOM, quotes, embedded commas and line breaks, and blank lines", () => {
    const recs = parseCsv('﻿a,b\r\n\r\n"x, y","say ""hi"""\r\n"two\nlines",z\n');
    expect(recs).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 3, cells: ["x, y", 'say "hi"'] },
      { line: 4, cells: ["two\nlines", "z"] },
    ]);
  });

  it("falls back to tab or semicolon when the first line has no comma", () => {
    expect(parseCsv("a;b\n1;2").map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2").map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("never throws on an unterminated quote and keeps a last line without a newline", () => {
    expect(parseCsv('a,"b').map((r) => r.cells)).toEqual([["a", "b"]]);
    expect(parseCsv("1,2\n3,4").map((r) => r.cells)).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n  \n")).toEqual([]);
  });

  it("parseYesNo: yes/no words, empty = keep, anything else = undefined", () => {
    expect(["yes", "Y", "TRUE", "1"].map(parseYesNo)).toEqual([true, true, true, true]);
    expect(["no", "N", "false", "0"].map(parseYesNo)).toEqual([false, false, false, false]);
    expect(parseYesNo("  ")).toBeNull();
    expect(parseYesNo("maybe")).toBeUndefined();
  });
});

describe("parsePincodeCsv", () => {
  it("reads a header in any order and ignores extra columns", () => {
    const r = parsePincodeCsv(
      "district,COD,Pincode,serviceable\nPune,no,411001,yes\nDelhi,,110001,false\n",
    );
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, pincode: "411001", serviceable: true, codAllowed: false },
      { line: 3, pincode: "110001", serviceable: false, codAllowed: null },
    ]);
  });

  it("reads a header-less file positionally", () => {
    const r = parsePincodeCsv("411001,yes,no\n110001,no\n");
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => [x.pincode, x.serviceable, x.codAllowed])).toEqual([
      ["411001", true, false],
      ["110001", false, null],
    ]);
  });

  it("reports every bad line with its line number", () => {
    const r = parsePincodeCsv(
      "pincode,serviceable,cod_allowed\n41100,yes,yes\n411002,maybe,yes\n411001,yes,\n411001,no,no\n560001,,\n",
    );
    expect(r.rows).toEqual([{ line: 4, pincode: "411001", serviceable: true, codAllowed: null }]);
    expect(r.issues.map((i) => [i.line, i.message.split(/[ .(]/)[0]])).toEqual([
      [2, '"41100"'],
      [3, '"maybe"'],
      [5, "Pincode"],
      [6, "Pincode"],
    ]);
    expect(r.issues[2]!.message).toMatch(/repeated \(first on line 4\)/);
    expect(r.issues[3]!.message).toMatch(/nothing to change/);
  });

  it("rejects an empty file and a header without the needed columns", () => {
    expect(parsePincodeCsv("").issues[0]!.message).toMatch(/empty/);
    expect(parsePincodeCsv("code,serviceable\n1,yes").issues[0]!.message).toMatch(/pincode/);
    expect(parsePincodeCsv("pincode,district\n411001,Pune").issues[0]!.message).toMatch(/serviceable/);
  });

  it("the export format reads back as itself", () => {
    const csv = pincodesCsv([
      { pincode: "411001", district: "Pune, East", stateCode: "27", stateName: "Maharashtra", zone: "rest_of_india", serviceable: false, codAllowed: true },
    ]);
    const r = parsePincodeCsv(csv);
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([{ line: 2, pincode: "411001", serviceable: false, codAllowed: true }]);
  });
});

describe("parseInventoryCsv", () => {
  it("reads the inventory export's SKU and On hand columns and ignores the rest", () => {
    const r = parseInventoryCsv(
      "Product,Variant,SKU,Status,On hand,Reserved,Available,Low-stock threshold,State\r\n" +
        'Heart,"Pink, big",PH-1,active,12,1,11,5,in\r\nSkull,Default,\'=X1,active,0,0,0,5,out\r\n',
    );
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, sku: "PH-1", stock: 12 },
      { line: 3, sku: "=X1", stock: 0 },
    ]);
  });

  it("reads a header-less sku,stock file", () => {
    const r = parseInventoryCsv("PH-1,4\nPH-2,7.0\n");
    expect(r.rows.map((x) => [x.sku, x.stock])).toEqual([
      ["PH-1", 4],
      ["PH-2", 7],
    ]);
  });

  it("flags empty, negative, fractional, huge and repeated values per line", () => {
    const r = parseInventoryCsv("sku,stock_on_hand\nA,\nB,-3\nC,1.5\nD,abc\nE,99999999\nF,2\nF,3\n,4\n");
    expect(r.rows).toEqual([{ line: 7, sku: "F", stock: 2 }]);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 6, 8, 9]);
    expect(r.issues[1]!.message).toMatch(/negative/);
    expect(r.issues[2]!.message).toMatch(/whole number/);
    expect(r.issues[4]!.message).toMatch(/too large/);
    expect(r.issues[5]!.message).toMatch(/repeated \(first on line 7\)/);
  });

  it("needs both header columns", () => {
    expect(parseInventoryCsv("SKU,Name\nA,x").issues[0]!.message).toMatch(/On hand/);
    expect(parseInventoryCsv("On hand,Name\n5,x").issues[0]!.message).toMatch(/SKU/);
    expect(parseInventoryCsv("").issues[0]!.message).toMatch(/empty/);
  });
});
