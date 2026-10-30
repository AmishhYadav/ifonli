/** Shown while an admin page reads the session and its data (a Suspense boundary above every page). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-6 h-7 w-48 rounded-md bg-admin-border" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-admin-border bg-admin-surface" />
        ))}
      </div>
      <div className="mt-6 h-64 rounded-lg border border-admin-border bg-admin-surface" />
    </div>
  );
}
