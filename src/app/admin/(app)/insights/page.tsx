import type { Metadata } from "next";

import { DateRangeForm } from "@/components/admin/analytics/DateRangeForm";
import { ReportCard, SimpleTable } from "@/components/admin/analytics/ReportParts";
import { StatCard } from "@/components/admin/dashboard/StatCard";
import { Badge, PageHeader, inputClasses } from "@/components/admin/ui";
import { formatINR } from "@/lib/money";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { istDateString } from "@/server/domain/ist";
import { parseDateRange } from "@/server/services/analytics/dates";
import { formatPercent } from "@/server/services/analytics/funnel";
import {
  addToCartRate,
  ctr,
  purchaseRate,
  reached75Rate,
  type ProductEngagement,
} from "@/server/services/analytics/insight-rules";
import { getInsights } from "@/server/services/analytics/insights";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Insights" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const TOP = 10;

const productCell = (r: ProductEngagement) => (
  <a href={`/products/${r.slug}`} className="hover:underline" target="_blank" rel="noreferrer">
    {r.name}
    <span className="sr-only"> (opens the storefront page)</span>
  </a>
);

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("insight:view");
  const sp = await searchParams;
  const now = new Date();
  const today = istDateString(now);
  const range = parseDateRange(sp, now);
  const requestedVibe = one(sp.vibe);
  const data = await getInsights(getDb(), range, {
    vibe: requestedVibe && /^[a-z][a-z0-9-]{0,31}$/.test(requestedVibe) ? requestedVibe : null,
  });
  const { totals, products } = data;
  const overallCtr = ctr(totals);
  const overallAtc = addToCartRate(totals);

  const byViews = products.filter((p) => p.pdpViews > 0).slice(0, TOP);
  const byImpressions = [...products].filter((p) => p.impressions > 0).sort((a, b) => b.impressions - a.impressions).slice(0, TOP);
  const byScroll = products.filter((p) => p.uniqueViewers > 0).slice(0, TOP);
  const conversion = products.filter((p) => p.impressions > 0 || p.pdpViews > 0).slice(0, 25);

  return (
    <>
      <PageHeader
        title="Insights"
        description="What visitors look at and what they do with it, from our own anonymous event counts. Product figures refresh hourly. Days are India (IST) days."
      />
      <DateRangeForm
        action="/admin/insights"
        range={range}
        today={today}
        linkOnly={data.vibe ? { vibe: data.vibe } : {}}
        extra={
          <div className="flex flex-col gap-1">
            <label htmlFor="insights-vibe" className="text-xs text-admin-ink-muted">
              Vibe
            </label>
            <select id="insights-vibe" name="vibe" defaultValue={data.vibe ?? ""} className={`${inputClasses} w-40`}>
              <option value="">All vibes</option>
              {data.vibes.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {data.rollupPending ? (
        <p role="status" className="mb-4 rounded-md border border-admin-border bg-admin-warning-soft px-3 py-2 text-[13px] text-admin-warning">
          Events were recorded in this range but the hourly summary has not run yet. Product figures appear after the next run.
        </p>
      ) : null}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Listing impressions" value={String(totals.impressions)} hint="Card seen for 1 second" />
        <StatCard label="Click-through rate" value={formatPercent(overallCtr)} hint="Clicks / impressions" />
        <StatCard label="Product page views" value={String(totals.pdpViews)} />
        <StatCard label="Add-to-cart rate" value={formatPercent(overallAtc)} hint="Add to carts / page views" />
        <StatCard label="Hero tile clicks" value={String(totals.heroTileClicks)} />
      </section>

      <div className="mt-5 grid gap-5">
        <ReportCard
          title="Worth a look"
          description="Products doing much worse than the shop as a whole, once they have enough views to judge. Biggest missed opportunity first."
        >
          <SimpleTable
            caption="Products worth a look"
            rows={data.findings.slice(0, 15)}
            rowKey={(f) => `${f.kind}-${f.productId}`}
            empty="Nothing stands out yet. Flags need at least 100 impressions, 30 page views or 10 add to carts per product."
            columns={[
              { header: "Product", cell: (f) => <a href={`/products/${f.slug}`} className="hover:underline" target="_blank" rel="noreferrer">{f.name}</a> },
              {
                header: "Signal",
                cell: (f) => (
                  <span className="block">
                    <Badge tone={f.kind === "low_purchase" ? "danger" : "warning"}>{f.title}</Badge>
                    <span className="mt-1 block text-xs text-admin-ink-muted">{f.hint}</span>
                  </span>
                ),
              },
              { header: "Its rate", numeric: true, cell: (f) => formatPercent(f.rate) },
              { header: "Shop rate", numeric: true, cell: (f) => formatPercent(f.benchmark) },
              { header: "Based on", numeric: true, cell: (f) => f.sample },
            ]}
          />
        </ReportCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportCard title="Most viewed" description="Product page views and unique viewers.">
            <SimpleTable
              caption="Most viewed products"
              rows={byViews}
              rowKey={(p) => p.productId}
              empty="No product page views yet."
              columns={[
                { header: "Product", cell: productCell },
                { header: "Views", numeric: true, cell: (p) => p.pdpViews },
                { header: "Unique viewers", numeric: true, cell: (p) => p.uniqueViewers },
              ]}
            />
          </ReportCard>
          <ReportCard title="Most seen in listings" description="Cards visible at least half, for a second.">
            <SimpleTable
              caption="Most seen in listings"
              rows={byImpressions}
              rowKey={(p) => p.productId}
              empty="No listing impressions yet."
              columns={[
                { header: "Product", cell: productCell },
                { header: "Impressions", numeric: true, cell: (p) => p.impressions },
                { header: "Clicks", numeric: true, cell: (p) => p.clicks },
              ]}
            />
          </ReportCard>
        </div>

        <ReportCard title="Scroll engagement" description="How far visitors scroll down the product page. Depth is the deepest of 25, 50, 75 and 100%.">
          <SimpleTable
            caption="Scroll engagement"
            rows={byScroll}
            rowKey={(p) => p.productId}
            empty="No scroll data yet."
            columns={[
              { header: "Product", cell: productCell },
              { header: "Viewers", numeric: true, cell: (p) => p.uniqueViewers },
              { header: "Average depth", numeric: true, cell: (p) => `${Math.round(p.avgScrollDepth)}%` },
              { header: "Reached 75%", numeric: true, cell: (p) => formatPercent(reached75Rate(p), 0) },
            ]}
          />
        </ReportCard>

        <ReportCard title="Conversion by product" description="From seeing a card to buying, for the busiest products.">
          <SimpleTable
            caption="Conversion by product"
            rows={conversion}
            rowKey={(p) => p.productId}
            empty="No data in this range."
            columns={[
              { header: "Product", cell: productCell },
              { header: "Impressions", numeric: true, cell: (p) => p.impressions },
              { header: "CTR", numeric: true, cell: (p) => formatPercent(ctr(p)) },
              { header: "Views", numeric: true, cell: (p) => p.pdpViews },
              { header: "Add to cart", numeric: true, cell: (p) => p.addToCarts },
              { header: "Add rate", numeric: true, cell: (p) => formatPercent(addToCartRate(p)) },
              { header: "Orders", numeric: true, cell: (p) => p.purchases },
              { header: "Bought / carted", numeric: true, cell: (p) => formatPercent(purchaseRate(p), 0) },
            ]}
          />
        </ReportCard>

        <ReportCard
          title="Vibe performance"
          description="Products filed under a vibe count towards it. Switches are how often visitors changed the site to that vibe."
        >
          <SimpleTable
            caption="Vibe performance"
            rows={data.vibePerformance}
            rowKey={(v) => v.slug}
            columns={[
              { header: "Vibe", cell: (v) => v.name },
              { header: "Impressions", numeric: true, cell: (v) => v.impressions },
              { header: "CTR", numeric: true, cell: (v) => formatPercent(ctr(v)) },
              { header: "Views", numeric: true, cell: (v) => v.pdpViews },
              { header: "Add rate", numeric: true, cell: (v) => formatPercent(addToCartRate(v)) },
              { header: "Revenue", numeric: true, cell: (v) => formatINR(v.revenuePaise) },
              { header: "Switches to", numeric: true, cell: (v) => v.switchesTo },
            ]}
          />
        </ReportCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportCard title="Hero tile clicks" description="Clicks on the animated hero, by tile.">
            <SimpleTable
              caption="Hero tile clicks"
              rows={data.heroTiles}
              rowKey={(t) => `${t.tile}-${t.vibe ?? ""}`}
              empty="No hero clicks in this range."
              columns={[
                { header: "Tile", cell: (t) => t.tile },
                { header: "Vibe", cell: (t) => t.vibe ?? "-" },
                { header: "Clicks", numeric: true, cell: (t) => t.clicks },
              ]}
            />
          </ReportCard>
          <ReportCard title="Searches with no results" description="What people looked for and did not find: candidates for new products or synonyms.">
            <SimpleTable
              caption="Searches with no results"
              rows={data.searchesNoResults}
              rowKey={(t) => t.term}
              empty="Every search found something."
              columns={[
                { header: "Search", cell: (t) => t.term },
                { header: "Times", numeric: true, cell: (t) => t.searches },
              ]}
            />
          </ReportCard>
        </div>

        <ReportCard title="Top searches" description="Search terms that look like an e-mail address or a phone number are never stored.">
          <SimpleTable
            caption="Top searches"
            rows={data.topSearches}
            rowKey={(t) => t.term}
            empty="No searches in this range."
            columns={[
              { header: "Search", cell: (t) => t.term },
              { header: "Times", numeric: true, cell: (t) => t.searches },
              { header: "Average results", numeric: true, cell: (t) => t.avgResults.toFixed(1) },
            ]}
          />
        </ReportCard>
      </div>
    </>
  );
}
