import { BG_STATES, type BgState } from "./data";

const vibeAttr = (state: BgState) =>
  state === "site" || state === "accent" ? {} : { "data-vibe": state };

/**
 * The fixed, viewport-sized dynamic background. Decorative.
 *
 * Every colour state is its own stacked layer; the motion code cross-fades them by opacity only. `site` uses
 * the visitor's own vibe tokens (inherited from <html>), the five vibe states re-skin through `data-vibe`,
 * and `accent` is the portal colour. Blobs are plain radial gradients that the motion code translates
 * and scales; nothing here is ever blurred with a filter.
 */
export function Background() {
  return (
    <div className="l-bg" aria-hidden="true" data-bg>
      <div className="l-bg__fills">
        {BG_STATES.map((state) => (
          <div key={state} className="l-bg__fill" data-state={state} {...vibeAttr(state)} />
        ))}
      </div>
      {(["a", "b", "c"] as const).map((blob) => (
        <div key={blob} className={`l-blob l-blob--${blob}`} data-blob={blob}>
          {BG_STATES.map((state) => (
            <div key={state} className="l-blob__fill" data-state={state} {...vibeAttr(state)} />
          ))}
        </div>
      ))}
    </div>
  );
}
