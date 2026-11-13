import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

import { VIBE_TAGLINES } from "@/components/store/vibe-taglines";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { VIBES, VIBE_NAMES, type Vibe } from "@/features/vibe/config";

import { Cutout } from "./Cutout";
import { HERO_CUTOUTS, MAKES, MOOD_CUTOUTS, PORTAL_CUTOUTS } from "./data";
import type { Fact } from "./facts";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Bungee Shade is ~9.7em wide for "Unapologetic": on one line it would be tiny on a phone and spill out of its column
 * on a tablet or laptop. The word is cut into a ragged-balanced block instead (UNA- / POLO- / GETIC, CSS adds the
 * hyphens). The pieces are plain text, so the heading's text stays "Unapologetic"; its accessible name is set explicitly (block pieces would otherwise be read as separate words).
 */
const MOOD_NAME_PARTS: Partial<Record<Vibe, readonly string[]>> = {
  bold: ["Una", "polo", "getic"],
};

/** The mood's name; a name with a designed break renders as one block per piece (every piece but the last is hyphenated). */
function MoodName({ vibe }: { vibe: Vibe }) {
  const parts = MOOD_NAME_PARTS[vibe];
  if (!parts) return VIBE_NAMES[vibe];
  return parts.map((part, i) => (
    <span key={part} className={i < parts.length - 1 ? "l-mood__part l-mood__part--hy" : "l-mood__part"}>
      {part}
    </span>
  ));
}

const LETTERS = ["I", "f", "O", "n", "l", "i"] as const;

/** Chapter 1: the LCP. Entrance is CSS only, so nothing waits for JS. */
export function Opening() {
  return (
    <section className="l-open" aria-labelledby="landing-title" data-opening>
      <div className="l-open__cuts" aria-hidden="true">
        {HERO_CUTOUTS.map((c, i) => (
          <div
            key={c.name}
            className={c.mobile ? "l-cut" : "l-cut l-cut--wide"}
            data-cut
            data-depth={c.depth}
            style={
              {
                "--x": c.x,
                "--y": c.y,
                "--s": c.size,
                "--mx": c.mobile?.x ?? c.x,
                "--my": c.mobile?.y ?? c.y,
                "--ms": c.mobile?.size ?? c.size,
                "--r": `${c.rot}deg`,
                "--d": `${c.delay}ms`,
                "--dur": `${c.dur}s`,
              } as Vars
            }
          >
            <Cutout name={c.name} className="l-cut__img" eager={i < 4} />
          </div>
        ))}
      </div>

      <div className="l-open__center">
        <div className="l-open__lift" data-open-lift>
          <h1 id="landing-title" className="l-wordmark" aria-label="IfOnli" data-wordmark>
            {LETTERS.map((ch, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={ch === "O" ? "l-ch l-ch--accent l-ch--gif" : i < 2 ? "l-ch" : "l-ch l-ch--accent"}
                style={{ "--i": i } as Vars}
              >
                {ch}
                {ch === "O" && (
                  <Image
                    src="/brand/wordmark-o-cat.gif"
                    alt=""
                    width={410}
                    height={410}
                    unoptimized
                    draggable={false}
                    loading="eager"
                    fetchPriority="high"
                    className="l-ch__gif"
                  />
                )}
              </span>
            ))}
          </h1>
          <p className="l-open__tag">Tiny things. Big feelings.</p>
          <p className="l-open__sub">
            Charms, 3D stickers and DIY kits in four moods. Made in India.
          </p>
        </div>
      </div>

      <div className="l-cue" aria-hidden="true" data-cue>
        <span>Scroll</span>
        <span className="l-cue__line" />
      </div>
    </section>
  );
}

/** Chapter 2: the three kinds of thing we make. */
export function Makes() {
  return (
    <section className="l-makes" aria-labelledby="makes-title" data-makes>
      <div className="l-wrap">
        <h2 id="makes-title" className="l-h2" data-reveal>
          Three kinds of tiny.
        </h2>
        <p className="l-lead" data-reveal>
          Pick one, or collect them all.
        </p>
        <ul className="l-makes__grid">
          {MAKES.map((item) => (
            <li key={item.id} className="l-make" data-make style={{ "--r": `${item.rot}deg` } as Vars}>
              <div className="l-make__art" aria-hidden="true">
                <Cutout name={item.art} className="l-make__img" />
              </div>
              <h3 className="l-make__name" data-make-text>
                {item.name}
              </h3>
              <p className="l-make__line" data-make-text>
                {item.line}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Chapter 3: four moods. Each panel is its own vibe scope, so its text takes that vibe's ink and fonts. */
export function Moods() {
  return (
    <section className="l-moods" aria-labelledby="moods-title" data-moods>
      <h2 id="moods-title" className="l-moods__title">
        Four moods, one for every you.
      </h2>
      <div className="l-moods__track" data-moods-track>
        <div className="l-moods__stage">
          {VIBES.map((vibe, index) => (
            <article key={vibe} className="l-mood" data-vibe={vibe} data-mood={index}>
              <div className="l-mood__in" data-mood-in>
                <div className="l-mood__copy">
                  <p className="l-mood__count" data-mood-count>
                    Mood {index + 1} of {VIBES.length}
                    <span className="l-pips" aria-hidden="true">
                      {VIBES.map((v, i) => (
                        <i key={v} className={i <= index ? "is-on" : undefined} />
                      ))}
                    </span>
                  </p>
                  <h3
                    className="l-mood__name"
                    data-mood-name
                    aria-label={MOOD_NAME_PARTS[vibe] ? VIBE_NAMES[vibe] : undefined}
                  >
                    <MoodName vibe={vibe} />
                  </h3>
                  <p className="l-mood__tag" data-mood-tag>
                    {VIBE_TAGLINES[vibe]}
                  </p>
                </div>
                <div className="l-mood__cuts" aria-hidden="true">
                  {MOOD_CUTOUTS[vibe].map((c) => (
                    <div
                      key={c.name}
                      className="l-mc"
                      data-mood-cut
                      style={
                        { left: `${c.x}%`, top: `${c.y}%`, width: `${c.size}%`, "--r": `${c.rot}deg` } as Vars
                      }
                    >
                      <Cutout name={c.name} className="l-mc__img" />
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Chapter 4: a few facts, read from the store's own settings. */
export function Why({ facts }: { facts: Fact[] }) {
  return (
    <section className="l-why" aria-labelledby="why-title" data-why>
      <div className="l-wrap">
        <h2 id="why-title" className="l-h2" data-reveal>
          Small things, handled with care.
        </h2>
        <ul className="l-facts">
          {facts.map((fact) => (
            <li key={fact.id} className="l-fact" data-reveal>
              <span
                className={fact.count === undefined ? "l-fact__fig" : "l-fact__fig l-fact__fig--num"}
                aria-hidden="true"
                data-count={fact.count}
                data-prefix={fact.prefix}
                data-suffix={fact.suffix}
              >
                {fact.figure}
              </span>
              <p className="l-fact__text">{fact.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Chapter 5: the portal. A card that opens to fill the screen and hands over to the store. */
export function Portal() {
  return (
    <section className="l-portal" aria-labelledby="portal-title" data-portal>
      <div className="l-portal__track" data-portal-track>
        <div className="l-portal__stage">
          <div className="l-portal__card" data-portal-card>
            <div className="l-portal__art" aria-hidden="true">
              {PORTAL_CUTOUTS.map((c) => (
                <div
                  key={c.name}
                  className={c.peek ? "l-pc l-pc--peek" : "l-pc"}
                  data-portal-cut
                  style={
                    { left: `${c.x}%`, top: `${c.y}%`, width: c.size, "--r": `${c.rot}deg` } as Vars
                  }
                >
                  <Cutout name={c.name} className="l-pc__img" />
                </div>
              ))}
            </div>
            <div className="l-portal__in" data-portal-in>
              <h2 id="portal-title" className="l-portal__title">
                Ready? Step inside.
              </h2>
              <p className="l-portal__text">
                Everything is waiting in the store.
                <span className="l-portal__hint"> Keep scrolling and it opens by itself.</span>
              </p>
              <Link
                href="/home"
                prefetch={false}
                className={buttonVariants({ size: "lg" })}
                data-portal-enter
                data-prefetch-intent
              >
                Enter the store
              </Link>
              <p className="l-portal__status" role="status" data-portal-status />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
