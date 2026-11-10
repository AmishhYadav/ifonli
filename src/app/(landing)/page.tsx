import type { Metadata } from "next";

import { JsonLd } from "@/components/store/JsonLd";
import { Background } from "@/features/landing/Background";
import { LandingBoot } from "@/features/landing/Boot";
import { buildFacts } from "@/features/landing/facts";
import { LandingMotion } from "@/features/landing/LandingMotion";
import { Makes, Moods, Opening, Portal, Why } from "@/features/landing/Sections";
import { DEFAULT_SHARE_IMAGE, organizationJsonLd } from "@/lib/seo";
import { FALLBACK_LANDING_FACTS, getLandingFacts, type LandingFacts } from "@/server/cache/landing";
import { getStoreInfo } from "@/server/cache/settings";

const TITLE = "IfOnli: charms, 3D stickers and DIY kits";
const DESCRIPTION =
  "Charms, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  // A page-level openGraph replaces the layout one, so the brand share card is passed explicitly.
  openGraph: { type: "website", siteName: "IfOnli", locale: "en_IN", title: TITLE, description: DESCRIPTION, url: "/", images: [DEFAULT_SHARE_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [DEFAULT_SHARE_IMAGE] },
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
        <LandingBoot />
      </div>
    </>
  );
}
