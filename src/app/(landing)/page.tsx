import type { Metadata } from "next";

import { JsonLd } from "@/components/store/JsonLd";
import { Background } from "@/features/landing/Background";
import { buildFacts } from "@/features/landing/facts";
import { LandingMotion } from "@/features/landing/LandingMotion";
import { Makes, Moods, Opening, Portal, Why } from "@/features/landing/Sections";
import { organizationJsonLd } from "@/lib/seo";
import { FALLBACK_LANDING_FACTS, getLandingFacts, type LandingFacts } from "@/server/cache/landing";
import { getStoreInfo } from "@/server/cache/settings";

export const metadata: Metadata = {
  title: { absolute: "IfOnli: charms, Hippers, 3D stickers and DIY kits" },
  description:
    "Charms, Hippers, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.",
  alternates: { canonical: "/" },
};

/**
 * Motion layout is opt-in: this runs while the HTML is parsed, before first paint, and only turns it on for
 * visitors who have not asked for reduced motion. Without JS (or with reduced motion) the page stays a plain
 * stack of fully visible chapters.
 */
const MOTION_FLAG_SCRIPT =
  "if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.currentScript.parentElement.setAttribute('data-motion','on');";

async function OrganizationLd() {
  const info = await getStoreInfo();
  return (
    <JsonLd
      data={organizationJsonLd({
        name: info.brandName,
        // Placeholders must not leak into structured data.
        legalName: info.legalName.isPlaceholder ? undefined : info.legalName.value,
        email: info.supportEmail.isPlaceholder ? undefined : info.supportEmail.value,
      })}
    />
  );
}

/** The cached settings read must never take the landing page down: fall back to the facts the owner gave. */
async function loadFacts(): Promise<LandingFacts> {
  try {
    return await getLandingFacts();
  } catch (error) {
    console.error("LandingPage: could not read store facts, using defaults", error);
    return FALLBACK_LANDING_FACTS;
  }
}

export default async function LandingPage() {
  const facts = buildFacts(await loadFacts());
  return (
    <>
      <OrganizationLd />
      <div className="landing" id="landing" data-landing suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: MOTION_FLAG_SCRIPT }} />
        <Background />
        <div className="l-content">
          <Opening />
          <Makes />
          <Moods />
          <Why facts={facts} />
          <Portal />
        </div>
        <LandingMotion />
      </div>
    </>
  );
}
