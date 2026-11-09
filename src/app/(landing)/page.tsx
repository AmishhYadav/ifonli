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
  title: { absolute: "IfOnli: charms, 3D stickers and DIY kits" },
  description:
    "Charms, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.",
  alternates: { canonical: "/" },
};

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
