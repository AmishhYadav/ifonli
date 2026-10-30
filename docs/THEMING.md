# Theming: the vibe engine

Five moods (`cute`, `bold`, `overthinking`, `gothic`, `funky`) re-skin the whole storefront. A hand button cycles
them in a fixed order. This is the implementation of `docs/PLAN.md` section 8 (FR-19, FR-20).

## Where things live

| What                                                                                  | Where                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Token values (single source of truth) and contrast pairs                              | `src/features/vibe/tokens.ts`                                                                                             |
| Generated CSS (do not hand-edit)                                                      | `src/styles/tokens/{base,cute,bold,overthinking,gothic,funky,buy}.css`                                                    |
| Generator / stale check                                                               | `scripts/build-tokens.ts` (`pnpm exec tsx scripts/build-tokens.ts [--check]`), logic in `src/features/vibe/tokens-css.ts` |
| Vibe ids, order, names, fonts, cookie/storage keys                                    | `src/features/vibe/config.ts`                                                                                             |
| Fonts + metric-matched fallback faces                                                 | `src/styles/fonts.css` (files in `public/fonts/`)                                                                         |
| Base element styles, texture layer, hand glyph masks, view transition, reduced motion | `src/styles/vibe.css`                                                                                                     |
| Tailwind bindings (`bg-surface`, `rounded-card`, `font-display`...)                   | `src/app/globals.css`                                                                                                     |
| Runtime (head script, store, hand button, URL sync, VibeText, VibeScope)              | `src/features/vibe/`                                                                                                      |
| Copy dictionaries                                                                     | `src/features/vibe/copy/`                                                                                                 |
| Hand art / textures                                                                   | `public/vibe/hands/{vibe}.svg`, `public/vibe/textures/{vibe}.svg`                                                         |
| SVG filters (`#wobble`, `#warp`, `#grain`)                                            | `src/features/vibe/VibeFilters.tsx` (rendered once in the root layout)                                                    |
| Playground (dev only)                                                                 | `/dev/vibe`                                                                                                               |

## Tokens, groups and scopes

CSS variables have no prefix: `--bg`, `--ink`, `--accent`, ... Tailwind utilities map to them:
`bg-bg bg-surface text-ink text-ink-muted bg-accent text-on-accent border-border text-price text-sale text-link`
(colours, via `@theme inline`) and `rounded-card rounded-button rounded-input shadow-card shadow-button border-token font-display font-body display-fx ease-vibe`
(via `@utility`, because the variable names equal the token names and a theme variable would be self-referencing).
Use `.icon` on an `<svg><use href="/icons/sprite.svg#i-bag"/></svg>` to get the icon stroke/linecap/linejoin/filter tokens.

Two groups:

- **Palette** (always applied, also on Buy pages): `bg surface surface-2 ink ink-muted accent on-accent accent-2 accent-3 border focus-ring success warning danger price sale link texture-ink texture-opacity`.
  `link` is an addition to the plan: Gothic's accent is a button colour that cannot be text on near-black, so links get their own token.
- **Shape / type / texture**: `font-display display-weight display-tracking display-stretch display-filter radius-card radius-button radius-input border-w shadow-card shadow-button icon-stroke icon-linecap icon-linejoin icon-filter hand-scale texture-url texture-size cursor motion-ease motion-dur`.
  `display-filter` (Funky `url(#warp)`, large headings only via `display-fx`) and `hand-scale` (Gothic 1.2, its hand art is thin) are additions.

Scoping:

- `:root` carries base. `[data-vibe="x"]` carries a vibe, so **any element** can re-skin its subtree (`<VibeScope vibe="gothic">`). Inside a scope the local `[data-vibe]` also gets `background: var(--bg)`, `color: var(--ink)` and its own texture layer.
- `[data-vibe-scope="buy"]` (put it on `<main>` of cart, checkout, confirmation, tracking) resets the **shape/type/texture** group to base values and leaves the palette alone. Base display font is the body font, so Buy pages download no display font. The full-page texture is hidden with `body:has(main[data-vibe-scope="buy"])::before`.
- Specificity: all selectors are one attribute, so order decides. `buy.css` is generated and imported **last**, so an element carrying both attributes gets the buy reset. A nested `[data-vibe]` on a descendant of a buy scope redeclares the variables on its own element and therefore wins for its subtree.

## Add a token

1. Add the key to `PALETTE_KEYS` or `SHAPE_KEYS` in `tokens.ts`, give it a value in `base` and (palette: all vibes) override where it differs.
2. `pnpm exec tsx scripts/build-tokens.ts`.
3. If it should be a utility, add `@theme inline` (colours) or `@utility` (everything else) in `src/app/globals.css`.
4. Palette colours that carry text or UI: add a pair to `COMMON_PAIRS` / `EXTRA_PAIRS` in `tokens.ts`.

Raw hex colours are only allowed in `tokens.ts`; ESLint (`no-restricted-syntax`) rejects them in `src/components`, `src/features` and `src/app` (the dev playground is exempt).

## Change a palette safely

1. Edit the value in `tokens.ts` (hex only: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`; anything else makes the checker throw).
2. `pnpm exec tsx scripts/build-tokens.ts && pnpm contrast`.
   `pnpm contrast` prints every pair for base and all five vibes and exits 1 on any failure or stale generated CSS. Text pairs need 4.5:1, UI pairs 3:1. Translucent foregrounds are composited over the pair's (opaque) background.
3. Gothic and Funky have extra pairs (`EXTRA_PAIRS`). Texture is not part of the maths: keep `texture-opacity` low (about 0.05 to 0.1; Overthinking is higher only because its ruled lines are 1.5 px hairlines).

## Copy: VibeText, copy keys

`<VibeText k="hero.headline" as="h1" className="..." />` renders **all five** variants as `<span data-v="x">` inside the wrapper; CSS shows the one that belongs to the nearest `[data-vibe]`.
The mechanism is a set of per-vibe custom properties (`--dv-cute: contents | none`, generated into the token files) read by `[data-v="x"] { display: var(--dv-x, none) }`.
This replaces the plan's `[data-vibe=x] [data-v=x]` descendant selector because custom properties inherit from the **nearest** ancestor, so nested VibeScopes show the right variant (a descendant selector would also match the outer vibe). The default vibe's variant is first in the DOM. Do not put layout classes on `data-v` elements (they are `display: contents`); style the wrapper.

Dictionaries are `copy/{vibe}.ts`, each `Record<CopyKey, string>`; a missing key is a type error. Scope is expressive surfaces only. Checkout, payment, legal, error-critical and notification copy stays neutral. No confirm-shaming, no false urgency or scarcity.

## HandButton

A real `<button>` (`src/features/vibe/HandButton.tsx`). All five hand glyphs (CSS masks of `public/vibe/hands/{vibe}.svg`, tinted with `currentColor`) and all five names are in the markup; CSS picks the active one, so the label is right before hydration. `aria-label` is "Change vibe, current: Cute, next: Bold" and tracks the store.

Click sequence: compute next from the cycle (wraps) > await `document.fonts.load()` of the next display font, capped at 120 ms > `document.startViewTransition(() => setVibe(next))` with a 250 ms root cross-fade (`::view-transition-*(root)` in `vibe.css`) > flick animation (rotate -18 > 8 > 0, origin 50% 90%). Reduced motion or no View Transitions API: instant swap, no flick. Afterwards, at idle, the **following** vibe's font, texture and hand art are warmed (the first warm happens after `load`). Hover, keyboard focus, or a 500 ms touch long-press shows "Next: Bold"; the tooltip has `pointer-events: none` and a long-press never switches.

`setVibe(v, { source })` (`store.ts`) applies `html[data-vibe]`, `<meta name="theme-color">`, cookie `ifonli_vibe` (1 year, `SameSite=Lax`, `path=/`), `localStorage`, `history.replaceState` for **only** the `vibe` param (path, hash, other params and `history.state` are kept), the polite live region (`#vibe-live`: "Vibe changed to Bold"), and fires `window` event `ifonli:vibe-change` with `{from, to, durationMs, usedViewTransition}`. `durationMs` runs from the click until the cross-fade has finished (budget: < 400 ms; about 280 to 310 ms measured). In dev builds, or builds with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`, `window.__ifonliVibe.last` holds the last detail.

`useVibe()` is `useSyncExternalStore` over `html[data-vibe]` (MutationObserver); the server snapshot is the default vibe, so there is no hydration mismatch. `VibeUrlSync` (client, in a Suspense boundary in the root layout) re-applies `?vibe=<current>` with `replaceState` after every client navigation; `syncUrl` is a no-op when the param already matches, so it cannot loop. Canonical URLs never include `?vibe`.

## No-flash strategy (pages stay static)

`VibeHeadScript` renders an inline, blocking `<script>` in `<head>` (built by `headScript.ts` from config and tokens, under 1 KB; a unit test enforces it). Order: `?vibe=` > cookie > `localStorage` > default (`"random"` picks one and persists it). It sets `html[data-vibe]` before first paint, persists to cookie and `localStorage` when the vibe came from the URL, injects `<link rel="preload" as="font" crossorigin>` for the active display font, and sets `theme-color`. The layout never reads `cookies()` or `headers()`, so every route remains `○ Static`. `<html>` has `suppressHydrationWarning` and a server-rendered fallback `data-vibe="cute"` for no-JS visitors. The body font (`figtree`, variable) is preloaded in the layout.

`VibeHeadScript` accepts `{ cycle, defaultVibe }`; later phases pass them from settings (`vibe_cycle`, `default_vibe`).
If a strict CSP is added, allow this script by hash (it is a static string per `{cycle, defaultVibe}`), not by nonce, to keep pages static.

Only the active display font is requested on first load: the five `@font-face` rules are only fetched when an element uses them. (The playground's side-by-side strip renders all five on purpose, so it loads all five.)

## Assets

- Hands: `public/vibe/hands/{cute,bold,overthinking,gothic,funky}.svg`, viewBox `0 0 64 64`, wrist near (32, 58). Used as `mask-image`.
- Textures: `public/vibe/textures/{vibe}.svg`, black on transparent, used as `mask-image` painted with `--texture-ink` at `--texture-opacity`. Natural tile sizes live in `--texture-size` (cute 192, bold 96, overthinking 1024x256, gothic 96, funky 128x96). Overthinking's margin line repeats every 1024 px on wide screens.
  `overthinking-paper.svg` (full-colour) is not used by default.
- Icons: `public/icons/sprite.svg` (symbols `i-*`).
- Filters: `#wobble` (Overthinking `--icon-filter`), `#warp` (Funky `--display-filter`, headings of 32 px or more only), `#grain`.

## Tests

- Unit: `tests/unit/vibe-*.test.ts` (cycle logic, config and token invariants, copy dictionaries, head script behaviour and size, contrast maths, every declared pair, generated CSS).
- E2E: `tests/e2e/vibe.spec.ts`, run against a production build with the playground enabled:
  `NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build && pnpm start -p 3100` then
  `E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test vibe`.
  Without the flag, `/dev/*` is a 404 in production builds.
