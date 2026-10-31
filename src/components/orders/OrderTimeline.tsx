import { formatDateTime } from "./format";

export interface TimelineEvent {
  type: string;
  note: string | null;
  createdAt: Date | string;
}

/** "payment_captured" -> "Payment captured", for the rare event that has no customer note. */
function humanize(type: string): string {
  const text = type.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Customer-visible order history, oldest first. */
export function OrderTimeline({ events }: { events: readonly TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-base text-ink-muted">
        Updates will show up here as your order moves along.
      </p>
    );
  }
  return (
    <ol className="flex flex-col" data-testid="timeline">
      {events.map((event, i) => {
        const last = i === events.length - 1;
        return (
          <li key={`${event.type}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
            <span aria-hidden="true" className="relative flex w-3 flex-none justify-center">
              <span
                className={`mt-1.5 size-3 rounded-full ${last ? "bg-accent" : "bg-ink-muted"}`}
              />
              {last ? null : <span className="absolute top-5 -bottom-1.5 w-px bg-border" />}
            </span>
            <div className="min-w-0">
              <p className="text-base leading-snug font-semibold">
                {event.note ?? humanize(event.type)}
              </p>
              <time
                dateTime={new Date(event.createdAt).toISOString()}
                className="text-sm text-ink-muted"
              >
                {formatDateTime(event.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
