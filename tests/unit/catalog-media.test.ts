import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImagePathError, imageProps, resolveImageUrl } from "@/server/services/media";
import {
  StorageError,
  createSignedReadUrl,
  createSignedUploadUrl,
  encodeObjectPath,
  ensureBuckets,
  publicUrl,
} from "@/server/storage";

const ENV = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("resolveImageUrl", () => {
  it("leaves site-relative placeholder paths alone", () => {
    expect(resolveImageUrl("/placeholders/cutouts/charm-heart.svg")).toBe(
      "/placeholders/cutouts/charm-heart.svg",
    );
  });

  it("maps bucket/path to the public storage URL", () => {
    expect(resolveImageUrl("products/abc/hero image.webp")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/products/abc/hero%20image.webp",
    );
    expect(resolveImageUrl("cutouts/x.png")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/cutouts/x.png",
    );
    expect(resolveImageUrl("content/banners/a.jpg")).toContain("/object/public/content/banners/a.jpg");
  });

  it("passes absolute http(s) URLs through", () => {
    expect(resolveImageUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
  });

  it("rejects private, unknown and malformed paths", () => {
    for (const bad of [
      "",
      "   ",
      "private/invoice.pdf",
      "mystery/a.png",
      "products",
      "products/",
      "//evil.example.com/a.png",
      "/placeholders/../secret",
      "products/../../private/a.png",
      "products//a.png",
    ]) {
      expect(() => resolveImageUrl(bad), bad).toThrow(ImagePathError);
    }
  });

  it("imageProps defaults the size", () => {
    expect(
      imageProps({ path: "/placeholders/x.svg", alt: "x", width: null, height: null }),
    ).toEqual({ src: "/placeholders/x.svg", alt: "x", width: 800, height: 800 });
    expect(imageProps({ path: "/p.svg", alt: "x", width: 512, height: 256 })).toMatchObject({
      width: 512,
      height: 256,
    });
  });
});

describe("storage helpers", () => {
  it("encodeObjectPath encodes segments and rejects traversal", () => {
    expect(encodeObjectPath("a b/c#d.png")).toBe("a%20b/c%23d.png");
    for (const bad of ["", "/a", "a//b", "a/../b", "./a"]) {
      expect(() => encodeObjectPath(bad)).toThrow(StorageError);
    }
  });

  it("publicUrl refuses the private bucket and unknown buckets", () => {
    expect(publicUrl("products", "a.png")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/products/a.png",
    );
    expect(() => publicUrl("private", "a.pdf")).toThrow(/private/);
    expect(() => publicUrl("nope", "a.png")).toThrow(/Unknown bucket/);
  });

  it("createSignedUploadUrl calls the sign endpoint with the service key", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ url: "/object/upload/sign/products/a%20b.png?token=tok123" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await createSignedUploadUrl("products", "a b.png");
    expect(out).toEqual({
      url: "http://127.0.0.1:54321/storage/v1/object/upload/sign/products/a%20b.png?token=tok123",
      token: "tok123",
      bucket: "products",
      path: "a b.png",
    });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("http://127.0.0.1:54321/storage/v1/object/upload/sign/products/a%20b.png");
    expect(call[1].method).toBe("POST");
    expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer service-key");
  });

  it("createSignedReadUrl validates expiry and builds an absolute URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ signedURL: "/object/sign/private/a.pdf?token=t" })),
    );
    expect(await createSignedReadUrl("private", "a.pdf", 60)).toBe(
      "http://127.0.0.1:54321/storage/v1/object/sign/private/a.pdf?token=t",
    );
    await expect(createSignedReadUrl("private", "a.pdf", 0)).rejects.toThrow(StorageError);
    await expect(createSignedReadUrl("private", "a.pdf", 10_000_000)).rejects.toThrow(StorageError);
  });

  it("surfaces storage API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "Bucket not found" }, { status: 404 })),
    );
    await expect(createSignedUploadUrl("products", "a.png")).rejects.toThrow(/Bucket not found/);
  });

  it("ensureBuckets creates missing buckets and updates existing ones", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url.replace("http://127.0.0.1:54321/storage/v1", "")}`);
        if (init.method === "GET") return Response.json([{ id: "products" }]);
        return Response.json({ name: "ok" });
      }),
    );
    const res = await ensureBuckets();
    expect(res.updated).toEqual(["products"]);
    expect(res.created).toEqual(["cutouts", "content", "private"]);
    expect(calls).toContain("PUT /bucket/products");
    expect(calls).toContain("POST /bucket");
  });

  it("requires configuration", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(ensureBuckets()).rejects.toThrow(/SERVICE_ROLE_KEY/);
  });
});
