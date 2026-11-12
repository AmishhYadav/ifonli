import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COMING_SOON_TYPES, ComingSoon } from "@/components/store/listing/ComingSoon";

describe("ComingSoon", () => {
  const html = renderToStaticMarkup(createElement(ComingSoon));

  it("says COMING SOON and that it is worth the wait", () => {
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("COMING SOON");
    expect(text).toContain("It&#x27;s worth the wait.");
    expect(html).toMatch(/<h2[^>]*>/);
  });

  it("keeps the Browse everything button, linking to the shop", () => {
    expect(html).toMatch(/<a[^>]*href="\/shop"[^>]*>Browse everything<\/a>/);
  });

  it("is for 3D stickers", () => {
    expect(COMING_SOON_TYPES).toContain("3d-stickers");
  });
});
