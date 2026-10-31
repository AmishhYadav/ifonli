import type { ReactNode } from "react";

import { PlaceholderValue } from "@/components/store/footer/PlaceholderValue";
import type { StoreInfo } from "@/server/cache/settings";
import type { ProductDetail } from "@/server/services/queries/types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="text-base text-ink">{children}</dd>
    </div>
  );
}

/**
 * Legal Metrology and E-Commerce Rules block: net quantity, country of origin, manufacturer / packer and
 * consumer care. Always visible (no accordion). A value that is still a settings placeholder is marked
 * (never shown as if it were real), same as the footer.
 */
export function LegalBlock({ product, store }: { product: ProductDetail; store: StoreInfo }) {
  const { legal } = product;
  const mark = (value: string, isPlaceholder: boolean) => (
    <PlaceholderValue value={{ value, isPlaceholder }} />
  );
  return (
    <section aria-labelledby="legal-heading" data-testid="legal-block">
      <h2 id="legal-heading" className="font-display text-xl display-fx">
        Product details
      </h2>
      <dl className="mt-2 divide-y divide-border border-y border-border">
        {legal.netQuantity ? <Row label="Net quantity">{legal.netQuantity}</Row> : null}
        {legal.dimensions ? <Row label="Dimensions">{legal.dimensions}</Row> : null}
        <Row label="Country of origin">{mark(legal.countryOfOrigin, legal.countryOfOriginIsPlaceholder)}</Row>
        <Row label="Manufacturer / packer">
          <span className="block font-semibold">
            {mark(legal.manufacturer.name, legal.manufacturerIsPlaceholder)}
          </span>
          <span className="block text-ink-muted">
            {mark(legal.manufacturer.address, legal.manufacturerIsPlaceholder)}
          </span>
        </Row>
        <Row label="Consumer care">
          <span className="block">
            <PlaceholderValue value={store.supportEmail}>
              <a className="underline underline-offset-4 hover:no-underline" href={`mailto:${store.supportEmail.value}`}>
                {store.supportEmail.value}
              </a>
            </PlaceholderValue>
          </span>
          <span className="block">
            <PlaceholderValue value={store.supportPhone} />
          </span>
        </Row>
      </dl>
    </section>
  );
}
