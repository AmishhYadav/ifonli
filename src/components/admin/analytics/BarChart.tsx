export interface BarDatum {
  label: string;
  value: number;
  /** Text for the tooltip and the summary ("₹1,299"). */
  display: string;
}

/**
 * Hand-rolled SVG bar chart (no chart library). Accessible by construction: the SVG is one labelled image
 * with a text summary, and every page that uses it also prints the same numbers in a table. Bars use
 * `currentColor`, so the colour comes from the admin tokens (`text-admin-primary`).
 */
export function BarChart({
  data,
  ariaLabel,
  height = 168,
}: {
  data: readonly BarDatum[];
  ariaLabel: string;
  height?: number;
}) {
  const width = 640;
  const padTop = 8;
  const padBottom = 22;
  const plotH = height - padTop - padBottom;
  const max = Math.max(...data.map((d) => d.value), 0);
  const slot = data.length > 0 ? width / data.length : width;
  const barW = Math.max(1, Math.min(28, slot * 0.7));
  const peak = data.reduce<BarDatum | null>((best, d) => (best === null || d.value > best.value ? d : best), null);
  const summary =
    peak && max > 0 ? `${ariaLabel}. Highest: ${peak.display} on ${peak.label}.` : `${ariaLabel}. No data in this range.`;
  const labelIdx = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
      className="h-auto w-full text-admin-primary"
    >
      <line x1="0" x2={width} y1={padTop + plotH} y2={padTop + plotH} className="stroke-admin-border" strokeWidth="1" />
      {data.map((d, i) => {
        const h = max > 0 ? Math.max(d.value > 0 ? 2 : 0, (d.value / max) * plotH) : 0;
        const x = i * slot + (slot - barW) / 2;
        return (
          <g key={d.label}>
            <rect x={x} y={padTop + plotH - h} width={barW} height={h} rx="2" fill="currentColor">
              <title>{`${d.label}: ${d.display}`}</title>
            </rect>
            {labelIdx.has(i) ? (
              <text
                x={Math.min(width - 2, Math.max(2, x + barW / 2))}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                className="fill-admin-ink-muted"
                fontSize="11"
              >
                {d.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
