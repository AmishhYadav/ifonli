/**
 * Shown while an admin page reads the session and its data (a Suspense boundary above every page).
 * Shaped like the typical page (header, stat row, a table-like panel) with a shimmer that sweeps across.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="admin-skeleton mb-2 h-8 w-56 rounded-xl" />
      <div className="admin-skeleton mb-7 h-4 w-80 max-w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-admin-border bg-admin-surface p-5 shadow-sm">
            <div className="admin-skeleton h-3.5 w-24 rounded-md" />
            <div className="admin-skeleton mt-4 h-8 w-32 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-2xl border border-admin-border bg-admin-surface p-5 shadow-sm">
        <div className="admin-skeleton h-4 w-40 rounded-md" />
        <div className="mt-5 flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="admin-skeleton h-10 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
