import { VibeText } from "@/features/vibe/VibeText";

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`/icons/sprite.svg#i-${name}`} />
    </svg>
  );
}

/** One of everything, token-driven only. Rendered inside a VibeScope, the buy panel, and the page itself. */
export function Sample({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="sample">
      <h3 className="font-display text-4xl leading-tight display-fx">{title}</h3>
      <p className="text-sm text-ink-muted">
        Body text stays in the shared body font. Prices, labels and forms never change shape across
        a page.
      </p>
      <p className="text-sm">
        Inline <a href="#sample-link">link in the vibe colour</a> and plain ink text.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-button border-token bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-button"
        >
          <Icon name="bag" />
          Add to bag
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-button border-token bg-surface px-4 py-2 text-sm font-semibold text-ink"
        >
          Save for later
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-card border-token bg-surface p-4 text-ink shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-display text-xl">Sticker pack</h4>
          <span className="rounded-button bg-accent-2 px-2.5 py-0.5 text-xs font-semibold text-ink">
            New
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-lg font-bold text-price">₹349</span>
          <s className="text-sm text-ink-muted">₹499</s>
          <span className="text-sm font-semibold text-sale">30% off</span>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">Pincode</span>
          <input
            className="min-h-11 rounded-input border-token bg-bg px-3 py-2 text-ink placeholder:text-ink-muted"
            placeholder="560001"
            inputMode="numeric"
          />
        </label>
        <div className="flex gap-3" aria-label="Icons">
          <Icon name="heart" />
          <Icon name="search" />
          <Icon name="truck" />
          <Icon name="sparkle" />
          <Icon name="gift" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-button bg-surface-2 px-3 py-1 text-ink">Surface 2</span>
        <span className="font-semibold text-success">In stock</span>
        <span className="font-semibold text-warning">Few left</span>
        <span className="font-semibold text-danger">Out of stock</span>
      </div>

      <button
        type="button"
        className="min-h-11 self-start rounded-button border-token bg-surface px-4 py-2 text-sm text-ink outline-3 outline-offset-2 outline-focus-ring"
      >
        Focus ring demo
      </button>

      <VibeText k="vibe.wearThis" className="text-xs text-ink-muted" />
    </div>
  );
}
