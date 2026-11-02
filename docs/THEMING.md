# Theming: the vibe engine

Four moods re-skin the whole storefront. Internal slugs stay `cute`, `funky`, `bold`, `gothic` (URLs, cookies); the names
shown to people are Mochi, Chaos Cabinet, Unapologetic and After the Dark (`VIBE_NAMES`). The nav/listing order is
`VIBES` (cute, funky, bold, gothic); the hand button cycles `DEFAULT_VIBE_CYCLE` (cute, gothic, funky, bold). Mochi and
Chaos Cabinet are light themes, Unapologetic (black) and After the Dark (purple-black) are dark. The look is soft:
rounded, hairline edges, diffused shadows, no textures; colours come from the owner's demo. This is the implementation of `docs/PLAN.md` section 8 (FR-19, FR-20).

## Where things live

| What                                                                                  | Where                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Token values (single source of truth) and contrast pairs                              | `src/features/vibe/tokens.ts`                                                                                             |
| Generated CSS (do not hand-edit)                                                      | `src/styles/tokens/{base,cute,funky,bold,gothic,buy}.css`                                                                 |
| Generator / stale check                                                               | `scripts/build-tokens.ts` (`pnpm exec tsx scripts/build-tokens.ts [--check]`), logic in `src/features/vibe/tokens-css.ts` |
| Vibe ids, order, names, fonts, cookie/storage keys                                    | `src/features/vibe/config.ts`                                                                                             |
| Fonts + metric-matched fallback faces                                                 | `src/styles/fonts.css` (files in `public/fonts/`)                                                                         |
| Base element styles, hand glyph masks, view transition (600 ms), reduced motion       | `src/styles/vibe.css`                                                                                                     |
| Tailwind bindings (`bg-surface`, `rounded-card`, `font-display`...)                   | `src/app/globals.css`                                                                                                     |
| Runtime (head script, store, hand button, URL sync, VibeText, VibeScope)              | `src/features/vibe/`                                                                                                      |
| Copy dictionaries                                                                     | `src/features/vibe/copy/`                                                                                                 |
| Hand art                                                                              | `public/vibe/hands/{vibe}.svg`                                                                                            |
| SVG filters (`#grain`)                                                                | `src/features/vibe/VibeFilters.tsx` (rendered once in the root layout)                                                    |
| Playground (dev only)                                                                 | `/dev/vibe`                                                                                                               |

## Tokens, groups and scopes

CSS variables have no prefix: `--bg`, `--ink`, `--accent`, ... Tailwind utilities map to them:
`bg-bg bg-surface text-ink text-ink-muted bg-accent text-on-accent border-border text-price text-sale text-link`
(colours, via `@theme inline`) and `rounded-card rounded-button rounded-input shadow-card shadow-button border-token font-display font-body display-fx ease-vibe`
(via `@utility`, because the variable names equal the token names and a theme variable would be self-referencing).
Use `.icon` on an `<svg><use href="/icons/sprite.svg#i-bag"/></svg>` to get the icon stroke/linecap/linejoin/filter tokens.

Two groups:

- **Palette** (always applied, also on Buy pages): `bg surface surface-2 ink ink-muted accent on-accent accent-2 accent-3 border hairline hand focus-ring success warning danger price sale link texture-ink texture-opacity`.
  `border` is the >= 3:1 colour and is ONLY for form-control outlines (inputs, checkboxes, radios; the `border-token` utility). Dividers, card edges and the header underline use `hairline` (`border-hairline`), a soft colour that is deliberately not contrast-checked; the global default `border-color` is `var(--hairline)`. `hand` is the skin tone of the hand logo.
  Product art gradients are not part of the palette: `ART_GRADIENTS` in `tokens.ts` holds two stops per vibe, emitted as `--art-<vibe>-a` / `-b` on `:root`, and `globals.css` exposes `.art-cute`, `.art-funky`, `.art-bold`, `.art-gothic` and `.art-none`. They are keyed by the PRODUCT's vibe, not the active theme (`art-${primaryVibe}` on the image tile).
  `link` is an addition to the plan: Gothic's accent is a button colour that cannot be text on near-black, so links get their own token.
- **Shape / type / texture**: `font-display display-weight display-tracking display-stretch display-filter radius-card radius-button radius-input border-w shadow-card shadow-button icon-stroke icon-linecap icon-linejoin icon-filter hand-scale texture-url texture-size cursor motion-ease motion-dur`.
  Every theme and base share the soft shape: pill buttons, 20px cards (base 16px), 14px inputs (base 12px), 1px border width, round icon caps, no filters, no textures (`texture-url: none`, `texture-opacity: 0`), motion `cubic-bezier(0.22, 1, 0.36, 1)` over 320ms, glow `shadow-button`, diffused `shadow-card` (light) or deep shadow plus a 6% inset ring (dark). `display-filter` and `hand-scale` are kept as inert tokens.

Scoping:

- `:root` carries base. `[data-vibe="x"]` carries a vibe, so **any element** can re-skin its subtree (`<VibeScope vibe="gothic">`). Inside a scope the local `[data-vibe]` also gets `background: var(--bg)` and `color: var(--ink)`.
- `[data-vibe-scope="buy"]` (put it on `<main>` of cart, checkout, confirmation, tracking) resets the **shape/type/texture** group to base values and leaves the palette alone. Base display font is the body font, so Buy pages download no display font.
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
   `pnpm contrast` prints every pair for base and all four vibes and exits 1 on any failure or stale generated CSS. Text pairs need 4.5:1, UI pairs 3:1. Translucent foregrounds are composited over the pair's (opaque) background.
3. Gothic, Funky and Bold have extra pairs (`EXTRA_PAIRS`). `hairline` and `hand` are decorative and not checked. Where a demo colour failed, the palette comments in `tokens.ts` record the original ("was ..."): keep the hue and move only the lightness.

## Copy: VibeText, copy keys

`<VibeText k="hero.headline" as="h1" className="..." />` renders **all four** variants as `<span data-v="x">` inside the wrapper; CSS shows the one that belongs to the nearest `[data-vibe]`.
The mechanism is a set of per-vibe custom properties (`--dv-cute: contents | none`, generated into the token files) read by `[data-v="x"] { display: var(--dv-x, none) }`.
This replaces the plan's `[data-vibe=x] [data-v=x]` descendant selector because custom properties inherit from the **nearest** ancestor, so nested VibeScopes show the right variant (a descendant selector would also match the outer vibe). The default vibe's variant is first in the DOM. Do not put layout classes on `data-v` elements (they are `display: contents`); style the wrapper.

Dictionaries are `copy/{vibe}.ts`, each `Record<CopyKey, string>`; a missing key is a type error. Scope is expressive surfaces only. Checkout, payment, legal, error-critical and notification copy stays neutral. No confirm-shaming, no false urgency or scarcity.

## HandButton

A real `<button>` (`src/features/vibe/HandButton.tsx`). All four hand glyphs (CSS masks of `public/vibe/hands/{vibe}.svg`, tinted with `currentColor`) and all four names are in the markup; CSS picks the active one, so the label is right before hydration. `aria-label` is "Change vibe, current: Mochi, next: After the Dark" and tracks the store.

Click sequence: compute next from the cycle (wraps) > await `document.fonts.load()` of the next display font, capped at 120 ms > `document.startViewTransition(() => setVibe(next))` with a 600 ms root cross-fade (`::view-transition-*(root)` in `vibe.css`) > flick animation (rotate -18 > 8 > 0, origin 50% 90%). Reduced motion or no View Transitions API: instant swap, no flick. Afterwards, at idle, the **following** vibe's font and hand art are warmed (the first warm happens after `load`). Hover, keyboard focus, or a 500 ms touch long-press shows "Next: After the Dark"; the tooltip has `pointer-events: none` and a long-press never switches.

`setVibe(v, { source })` (`store.ts`) applies `html[data-vibe]`, `<meta name="theme-color">`, cookie `ifonli_vibe` (1 year, `SameSite=Lax`, `path=/`), `localStorage`, `history.replaceState` for **only** the `vibe` param (path, hash, other params and `history.state` are kept), the polite live region (`#vibe-live`: "Vibe changed to Unapologetic"), and fires `window` event `ifonli:vibe-change` with `{from, to, durationMs, usedViewTransition}`. `durationMs` runs from the click until the cross-fade has finished (budget: < 900 ms; the 600 ms fade plus slack). In dev builds, or builds with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`, `window.__ifonliVibe.last` holds the last detail.

`useVibe()` is `useSyncExternalStore` over `html[data-vibe]` (MutationObserver); the server snapshot is the default vibe, so there is no hydration mismatch. `VibeUrlSync` (client, in a Suspense boundary in the root layout) re-applies `?vibe=<current>` with `replaceState` after every client navigation; `syncUrl` is a no-op when the param already matches, so it cannot loop. Canonical URLs never include `?vibe`.

## No-flash strategy (pages stay static)

`VibeHeadScript` renders an inline, blocking `<script>` in `<head>` (built by `headScript.ts` from config and tokens, under 1 KB; a unit test enforces it). Order: `?vibe=` > cookie > `localStorage` > default (`"random"` picks one and persists it). It sets `html[data-vibe]` before first paint, persists to cookie and `localStorage` when the vibe came from the URL, injects `<link rel="preload" as="font" crossorigin>` for the active display font, and sets `theme-color`. The layout never reads `cookies()` or `headers()`, so every route remains `○ Static`. `<html>` has `suppressHydrationWarning` and a server-rendered fallback `data-vibe="cute"` for no-JS visitors. The body font (`nunito`, variable) is preloaded in the layout.

`VibeHeadScript` accepts `{ cycle, defaultVibe }`; later phases pass them from settings (`vibe_cycle`, `default_vibe`).
If a strict CSP is added, allow this script by hash (it is a static string per `{cycle, defaultVibe}`), not by nonce, to keep pages static.

Only the active display font is requested on first load: the `@font-face` rules are only fetched when an element uses them. (The playground's side-by-side strip renders all four on purpose, so it loads all four.)

## Assets

- Hands: `public/vibe/hands/{cute,funky,bold,gothic}.svg`, viewBox `0 0 64 64`, wrist near (32, 58). Used as `mask-image`.
- Textures: retired. `public/vibe/textures/{vibe}.svg` still exist only because the hand button's warm-up still fetches them; every theme sets `texture-url: none` and `texture-opacity: 0`.
- Fonts (`public/fonts`, Latin subset): body Nunito (variable 400-800); display Fredoka (Mochi), Rubik Glitch (Chaos Cabinet), Bebas Neue (Unapologetic), Creepster (After the Dark).
- Icons: `public/icons/sprite.svg` (symbols `i-*`).
- Filters: `#grain` only (`#wobble` and `#warp` were removed with their effects).

## Tests

- Unit: `tests/unit/vibe-*.test.ts` (cycle logic, config and token invariants, copy dictionaries, head script behaviour and size, contrast maths, every declared pair, generated CSS).
- E2E: `tests/e2e/vibe.spec.ts`, run against a production build with the playground enabled:
  `NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build && pnpm start -p 3100` then
  `E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test vibe`.
  Without the flag, `/dev/*` is a 404 in production builds.
