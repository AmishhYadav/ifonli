import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { stripImageMetadata } from "@/server/services/admin/product-images";

/** A 40x20 image carrying EXIF with a camera owner, a GPS position and a "rotate 90" orientation. */
async function withExif(format: "jpeg" | "png" | "webp") {
  const base = sharp({ create: { width: 40, height: 20, channels: 3, background: "#c00" } }).withExif({
    IFD0: { Copyright: "Secret Owner", Artist: "Someone" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "77/1 35/1 0/1" },
  });
  return base.toFormat(format).toBuffer();
}

describe("stripImageMetadata", () => {
  it.each(["jpeg", "png", "webp"] as const)("removes EXIF and GPS from a %s", async (format) => {
    const original = await withExif(format);
    const before = await sharp(original).metadata();
    expect(before.exif, "the fixture should carry EXIF").toBeDefined();
    expect(original.toString("latin1")).toContain("Secret Owner");

    const clean = await stripImageMetadata(original, format);
    const after = await sharp(clean).metadata();
    expect(after.format).toBe(format);
    expect(after.exif).toBeUndefined();
    expect(clean.toString("latin1")).not.toContain("Secret Owner");
    expect(clean.toString("latin1")).not.toContain("GPS");
  });

  it("applies the orientation to the pixels so the picture is not left sideways", async () => {
    const tagged = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#0a0" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const clean = await stripImageMetadata(tagged, "jpeg");
    const meta = await sharp(clean).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.orientation).toBeUndefined();
  });

  it("keeps transparency", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.4 } },
    })
      .png()
      .toBuffer();
    expect((await sharp(await stripImageMetadata(png, "png")).metadata()).hasAlpha).toBe(true);
  });
});
