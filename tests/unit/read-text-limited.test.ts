import { describe, expect, it } from "vitest";

import { readTextLimited } from "@/server/security/request";

const enc = new TextEncoder();

/** A request whose body arrives as the given chunks, with NO Content-Length (like a chunked upload). */
function chunked(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    body,
    headers,
    // Required by undici for a streamed request body.
    duplex: "half",
  } as RequestInit);
}

const plain = (text: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body: text, headers });

describe("readTextLimited", () => {
  it("returns the text when the body is under the limit, and when it is exactly the limit", async () => {
    expect(await readTextLimited(plain("hello"), 100)).toBe("hello");
    expect(await readTextLimited(plain("12345"), 5)).toBe("12345");
  });

  it("returns an empty string for an empty or missing body", async () => {
    expect(await readTextLimited(new Request("http://localhost/x", { method: "POST" }), 10)).toBe("");
    expect(await readTextLimited(plain(""), 10)).toBe("");
  });

  it("returns null when the body is over the limit (one byte over is enough)", async () => {
    expect(await readTextLimited(plain("123456"), 5)).toBeNull();
  });

  it("refuses on Content-Length alone, without reading the body", async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled = true;
          c.enqueue(enc.encode("x"));
          c.close();
        },
      },
      { highWaterMark: 0 }, // nothing is pulled until someone reads
    );
    const req = new Request("http://localhost/x", {
      method: "POST",
      body,
      headers: { "content-length": "999" },
      duplex: "half",
    } as RequestInit);
    expect(await readTextLimited(req, 10)).toBeNull();
    expect(pulled).toBe(false);
  });

  it("stops reading a chunked body with no Content-Length as soon as the cap is passed", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        // An endless stream: only the cap can end this read.
        controller.enqueue(enc.encode("a".repeat(1024)));
      },
    });
    const req = new Request("http://localhost/x", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    expect(await readTextLimited(req, 4 * 1024)).toBeNull();
    // 4 KB cap, 1 KB chunks: it gave up after a handful of pulls, not after reading "everything".
    expect(pulls).toBeLessThan(20);
  });

  it("ignores a Content-Length that understates the body", async () => {
    const req = chunked([enc.encode("a".repeat(50))], { "content-length": "3" });
    expect(await readTextLimited(req, 10)).toBeNull();
  });

  it("counts bytes, not UTF-16 units: multi-byte text over the byte cap is refused", async () => {
    const text = "€".repeat(4); // 4 characters (string length 4), 12 bytes
    expect(text.length).toBe(4);
    expect(await readTextLimited(plain(text), 12)).toBe(text);
    expect(await readTextLimited(plain(text), 11)).toBeNull();
    expect(await readTextLimited(chunked([enc.encode(text)]), 11)).toBeNull();
  });

  it("decodes exactly like req.text(), including characters split across chunks", async () => {
    const text = '{"name":"Zoë € 😀 日本語","n":1}';
    const bytes = enc.encode(text);
    // One byte per chunk splits every multi-byte character in the middle.
    const oneByteChunks = Array.from(bytes, (b) => new Uint8Array([b]));
    const viaLimited = await readTextLimited(chunked(oneByteChunks), 1024);
    const viaText = await new Request("http://localhost/x", { method: "POST", body: bytes }).text();
    expect(viaLimited).toBe(text);
    expect(viaLimited).toBe(viaText);
  });

  it("matches req.text() for a BOM and for invalid UTF-8 (the signature is over this string)", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('{"a":1}')]);
    const invalid = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    for (const bytes of [withBom, invalid]) {
      const expected = await new Request("http://localhost/x", { method: "POST", body: bytes }).text();
      expect(await readTextLimited(chunked([bytes]), 1024)).toBe(expected);
    }
  });
});
