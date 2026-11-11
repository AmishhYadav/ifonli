import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Meet the three founders behind IfOnli: cute accessories, quirky finds and thoughtful gifts, all in one place. Because life's too short for boring stuff.",
  alternates: { canonical: "/about" },
};

const FOUNDERS = [
  {
    name: "Ishika Yadav",
    role: "Creative & Product Director",
    bio: "The creative force behind IfOnli. Ishika brings ideas to life through product curation, creative direction and brand expression. She's the mind behind making sure every little detail reflects the unique personality of IfOnli.",
  },
  {
    name: "Sunny Mishra",
    role: "Operations & Technology Director",
    bio: "The one making things happen behind the scenes. Sunny looks after operations and technology, ensuring that the platform, processes and overall customer experience work seamlessly.",
  },
  {
    name: "Apurva Kulkulewar",
    role: "Sales & Inventory Director",
    bio: "The person keeping products and people connected. Apurva manages sales and inventory, ensuring products are organised, available and ready to find their way to the people who love them.",
  },
] as const;

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

/** About IfOnli: the founders, the story and the people behind the store. */
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex max-w-2xl flex-col gap-4">
        <p className="text-sm font-bold tracking-widest text-ink-muted uppercase">Meet the founders</p>
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-6xl">
          Three minds. One obsession. Zero boring accessories.
        </h1>
        <p className="text-lg text-ink-muted">
          Behind IfOnli is a team of three who believe that accessories should be anything but ordinary.
        </p>
      </header>

      <section aria-labelledby="story" className="mt-12 flex max-w-2xl flex-col gap-4 text-base">
        <h2 id="story" className="font-display text-3xl display-fx sm:text-4xl">
          Our story
        </h2>
        <p>IfOnli started with a simple observation: nobody wants boring accessories!</p>
        <p>
          We noticed how people love picking cute, quirky little things for themselves and gifting them to people they
          care about. Sometimes, it&apos;s not about the size or price of a gift, but how something small can instantly
          light up someone&apos;s mood or make them feel special.
        </p>
        <p>
          We wanted to bring all these little joys together in one place. That&apos;s how IfOnli came to life: an
          e-commerce space specially curated for people who love cute accessories, quirky finds, thoughtful gifting and
          expressing their individuality.
        </p>
        <p>From little mood boosters to accessories that make a statement, we believe there&apos;s something for everyone.</p>
        <p className="font-bold">Because life&apos;s too short for boring stuff!</p>
      </section>

      <section aria-labelledby="people" className="mt-12">
        <h2 id="people" className="font-display text-3xl display-fx sm:text-4xl">
          The people behind IfOnli
        </h2>
        <ul className="mt-6 grid gap-3 sm:gap-4 md:grid-cols-3">
          {FOUNDERS.map((founder) => (
            <li key={founder.name}>
              <article className="flex h-full flex-col gap-3 rounded-card bg-surface p-6 text-ink shadow-card">
                <span
                  aria-hidden="true"
                  className="grid size-14 place-items-center rounded-full bg-accent font-display text-xl text-on-accent"
                >
                  {initials(founder.name)}
                </span>
                <div>
                  <h3 className="font-display text-2xl leading-tight">{founder.name}</h3>
                  <p className="text-sm font-bold tracking-wide text-ink-muted uppercase">{founder.role}</p>
                </div>
                <p className="text-base text-ink-muted">{founder.bio}</p>
              </article>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="way" className="mt-12 flex max-w-2xl flex-col gap-4 text-base">
        <h2 id="way" className="font-display text-3xl display-fx sm:text-4xl">
          That&apos;s the IfOnli way!
        </h2>
        <p>
          We aren&apos;t just bringing accessories together. We&apos;re bringing together little things that spark joy,
          make gifting special and let personalities shine.
        </p>
        <p className="font-bold">Find your vibe. Pick your little obsession. Gift someone a smile.</p>
        <p className="italic text-ink-muted">With love, Team IfOnli ♡</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild size="lg" iconEnd="arrow-right">
            <Link href="/shop">Shop all</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/help">Talk to us</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
