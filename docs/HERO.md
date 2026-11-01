# Animated hero (FR-21, plan section 9, phase 7)

The static poster (`src/features/hero/HeroPoster.tsx`) is the server-rendered LCP view and stays the only view for
reduced motion, data saver, 2g-class connections and no JS. The animation is a progressive enhancement that lays itself
over the poster cells without moving anything (no layout shift), then replaces the poster tiles (which become `inert`).

## How it loads

`HeroEnhancer` (client, a few hundred bytes) mounts in `#hero-stage-root`. It loads the stage chunk with
`next/dynamic(() => import("./stage/HeroStage"), { ssr: false })` only when **all** of these hold:

- `prefers-reduced-motion` is not `reduce` (and if it becomes `reduce` later the stage unmounts and the poster returns);
- `navigator.connection.saveData` is false and `effectiveType` is not `slow-2g` or `2g` (`stage/eligibility.ts`);
- the device is not low-end (`isLowEnd`: 2 GB of memory or less, or 4 cores or fewer together with 4 GB or less; browsers
  that do not report these, such as Safari and Firefox, are never treated as low-end);
- the hero is in the viewport (IntersectionObserver), the page has loaded, and the visitor has either interacted
  (pointer, key, touch, wheel, scroll) or `SETTLE_MS` (2.5 s) has passed; then `requestIdleCallback` (300 ms timeout
  fallback on Safari). The stage starts on the poster's rest frame, so the late hand-over is invisible, and the first
  seconds (hydration, first taps) keep the main thread to themselves.

The admin setting `hero_enabled` (Settings > Vibes, default on) is checked first, on the server: when it is off
`HeroPoster` does not mount `HeroEnhancer` at all, so the poster is the whole hero, the stage chunk is never
requested and no `hero_impression` is reported. The cached vibe settings carry the `settings` tag, so saving the
setting takes effect without a redeploy.

The chunk (GSAP core + CSSPlugin + DrawSVGPlugin + the stage code) is **about 43 KB gzip / 39 KB brotli** (measured by
bundling `HeroStage.tsx` with esbuild, React and Next external; the plan budget is 70 KB). Flip is not used: tile
poses are computed (pure functions), so Flip's DOM-state diffing would add 8 KB for nothing. The Web Animations API
was considered and rejected: the timeline needs seek (storyboard, tests), per-scene staggers and DrawSVG.

## Files

| Path                                                     | Role                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/features/hero/HeroPoster.tsx`                       | Static poster (edited: data attributes, mount of `HeroEnhancer`, `pb-14` for the Pause/Play strip)      |
| `src/features/hero/HeroEnhancer.tsx`                     | Lazy-load conditions, `hero_impression`, poster tile clicks                                             |
| `src/features/hero/stageTiles.ts`                        | Server: per-vibe tile data (slug, name, `getImageProps` URL) for the stage                              |
| `src/features/hero/stage/schedule.ts`                    | The 10 scenes, 12 s loop, boundaries, profile-switch rule, dissolve curve, storyboard/sample timestamps |
| `src/features/hero/stage/profiles/{vibe}.ts`             | The five motion profiles                                                                                |
| `src/features/hero/stage/scenes/scene01..10.ts`          | Scene modules, each builds its tweens into the master timeline                                          |
| `src/features/hero/stage/timeline.ts`                    | Builds the one parameterised GSAP timeline (baseline state, scenes, ambient flicker/wobble)             |
| `src/features/hero/stage/poses.ts`, `geometry.ts`        | Pure layout maths: poses per scene, stage geometry, poster cells, swirl                                 |
| `src/features/hero/stage/director.ts`                    | Playback: pause reasons, observers, hover/focus label, toggle, profile switch, events, test hook        |
| `src/features/hero/stage/flash.ts`                       | WCAG 2.3.1 guard (see below)                                                                            |
| `src/features/hero/stage/HeroStage.tsx`, `HeroStageView` | Client entry of the lazy chunk and its markup                                                           |
| `src/features/hero/stage/analytics.ts`                   | Analytics adapter (see below)                                                                           |
| `src/styles/hero.css`                                    | Stage styles, loaded with the chunk; tokens only                                                        |
| `src/app/dev/hero/`                                      | Dev storyboard, `/dev/hero`                                                                             |

## Scenes (12 s loop)

| #   | Scene                                            | s   |
| --- | ------------------------------------------------ | --- |
| 1   | One tile on a design canvas, selection handles   | 1.2 |
| 2   | Splits into a pair, connector, square to circle  | 1.2 |
| 3   | Fan out on spokes, two to three large heroes     | 1.4 |
| 4   | Dark turn: 3D rotation, streaks, echo row        | 1.0 |
| 5   | Dense collage zooms, dissolves to colour + badge | 1.2 |
| 6   | Scatter, swirl to spiral, ring clusters          | 1.4 |
| 7   | Snap to cross, checkerboard, strip               | 1.4 |
| 8   | Product-silhouette burst                         | 0.8 |
| 9   | Grid and highlight wave; **rest frame = poster** | 1.6 |
| 10  | Book-page flip back to the opening tile          | 0.8 |

Playback starts on the settled rest frame of scene 9 (`REST_TIME`, identical to the poster), so the hand-over has no
visual jump. Every tween is a `fromTo` between two known values (the end pose of scene `k` is the start pose of scene
`k + 1` by construction), so any playhead position renders exactly. The 10 scene modules and the profile are the only
things that vary: colours always come from the active vibe's tokens (decision C-05).

### Playback speed

The schedule above is in loop time. The live stage plays it at `HERO_TIME_SCALE` (`schedule.ts`, currently 0.8), applied
with `timeline.timeScale()` in the Director on every (re)build, so one loop takes 15 s on the wall clock. `totalTime()`,
`__ifonliHero.seek()`, the scene boundaries, the dissolve curve and the storyboard are unaffected (they use loop time).
Keep the scale at or below 1: a slower timeline only lengthens each dissolve, so `flash.ts` stays valid. Wall-clock things
(label fade, hero impression timer, idle load) are independent of it.

## Motion profiles (`profiles/{vibe}.ts`)

| Vibe         | Personality                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| Cute         | `back.out` / `elastic.out`, springy pops, curved connectors                 |
| Bold         | `expo` glides and `steps()` snaps, square-cornered connectors, dark 0.9     |
| Overthinking | `hesitate()` ease (stops to reconsider twice), DrawSVG scribble connectors  |
| Gothic       | slow `sine`, fade through black, candle-glow flicker (amplitude 0.07, 2 Hz) |
| Funky        | wavy detours, wobbling products (7 deg), 70s wave connectors, elastic       |

### Switching vibe

The site vibe changes immediately (tokens, copy). The motion profile and the product set change at the **next scene
boundary**: the stage content dissolves out over 300 ms ending at the boundary, the Director rebuilds the timeline for
the new profile at the same playhead and swaps the tiles, and the content dissolves in over 300 ms. Rules
(`schedule.ts`, unit-tested):

- if the next boundary is closer than 300 ms the following boundary is used (the dissolve needs its full length);
- two profile dissolves are at least 1 s apart (keeps dissolves under 3 per second);
- if nobody can see the stage (visitor paused it, off-screen, hidden tab) the switch is applied at once.

## Accessibility and safety

- **WCAG 2.2.2**: a visible Pause/Play button (min 44 px, `aria-label` "Pause hero animation" / "Play hero animation"),
  bottom-right of the hero, first in the stage's tab order. It sits in the strip the poster reserves under the grid so
  it never covers a tile or the text card. A visitor who paused stays paused (hover/focus/visibility only add reasons).
- **Hover or keyboard focus** on a tile pauses the timeline and shows the product name in a label (Escape dismisses it,
  WCAG 1.4.13). Touch does not hover-pause. Tiles are real `<a href="/products/slug">` links (client navigation via
  `router.push`, modifier clicks keep native behaviour). Repeated tiles are `aria-hidden` with `tabindex=-1`.
- **Pauses** when the hero is off-screen (IntersectionObserver) and when the tab is hidden (`visibilitychange`).
- **The Shop button is never covered**: the text card (`z-10`, opaque surface) sits above every stage layer.
- **WCAG 2.3.1 (`flash.ts`)**: every luminance change is a cross-dissolve of at least 200 ms (veil layers use
  `sine.inOut`, never stepped or elastic); at most 4 luminance transitions start in any second (a flash is two, so this
  is at most 2 flashes against the limit of 3), including the loop wrap and the worst case of a profile switch at every
  allowed boundary; the Gothic flicker is an opacity swing of 0.07 (limit 0.1) at 2 Hz (limit 3). Unit and e2e tests
  prove it for all five profiles.
- **Performance**: only transforms and opacity are animated (plus `stroke-dashoffset` on a few small DrawSVG paths).
  `will-change` is set only while running (`[data-running="true"]`). DOM tiles: 56 (wide) or 36 (stacked), never over
  60; fewer products than tiles repeat in order (as the poster does). Images are the 384 px `next/image` URL, 12 per
  vibe at most, so the stage adds no requests beyond the active vibe's tiles.

## Analytics adapter

The hero does not depend on the beacon. It dispatches `CustomEvent("ifonli:analytics", { detail: { name, props } })`
on `window` (`stage/analytics.ts`, type `HeroEventDetail`). To wire it to the first-party beacon, once in app code:

```ts
window.addEventListener("ifonli:analytics", (e) => {
  const { name, props } = (e as CustomEvent<HeroEventDetail>).detail;
  track(name, props);
});
```

| Event             | Props                                | When                                                                         |
| ----------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `hero_impression` | `{ vibe, animated }`                 | Hero at least 50% visible for 1 s, once per page view                        |
| `hero_tile_click` | `{ slug, position, vibe, animated }` | A tile was activated: stage tile (`animated: true`) or poster tile (`false`) |
| `hero_pause`      | `{ vibe, scene }`                    | The visitor pressed Pause (hover/focus pauses are not reported)              |
| `hero_play`       | `{ vibe, scene }`                    | The visitor pressed Play                                                     |

## Dev tools and tests

- `/dev/hero` (gated like `/dev/vibe`): pick a vibe and layout; ten frames, one per scene, rendered by seeking the
  production timeline to each scene's key time (`STORYBOARD_TIMES`). The text card is a mock-up.
- Test hook `window.__ifonliHero` (non-production builds, or builds made with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`):
  `ready`, `seek(t)`, `pause()`, `play()` (the "test" pause reason, independent of the visitor's button) and `state()`
  (`t`, `scene`, `profile`, `pending`, `pendingBoundary`, `paused`, `tileCount`).
- Unit: `tests/unit/hero-*.test.ts` (schedule, boundaries and profile switch, tile repetition, poses, connectors,
  profiles, flash-rate guard, eligibility). E2E: `tests/e2e/hero.spec.ts`.

```
NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm dev -p 3105     # or a production build with the same flag
E2E_BASE_URL=http://localhost:3105 pnpm exec playwright test hero --project chromium-desktop
```

## Open items for the owner

- Motion feel per vibe is a proposal: review the `/dev/hero` storyboard, then real playback, and adjust the profile files.
- Product cutouts are placeholders (SVG silhouettes); the silhouette burst and tiles look different with real PNG/WebP
  cutouts (alpha channel required, see plan section 9).
- Lighthouse (home, mobile, hero enabled, target 85 or higher) and a real-device pass (mid-range Android, iPhone) are
  still to be run on a production build.
