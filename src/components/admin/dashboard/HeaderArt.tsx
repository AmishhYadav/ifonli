/**
 * Abstract artwork for the dashboard header: soft overlapping discs in the logo colours, a thin
 * orbit ring that turns slowly and two charms that float. Decorative only; sits behind the title.
 */
export function HeaderArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-2 right-0 hidden h-36 w-80 sm:block lg:right-6 lg:w-[26rem]"
    >
      <div className="absolute top-0 right-24 size-24 rounded-full bg-[image:var(--admin-grad)] opacity-70" />
      <div className="absolute top-12 right-8 size-16 rounded-full bg-admin-butter/80 mix-blend-multiply" />
      <div className="absolute top-0 right-44 size-12 rounded-full bg-admin-coral/50 mix-blend-multiply" />
      <div className="admin-ring-art top-0 right-16 size-32" />
      <div className="admin-float top-4 right-52" style={{ animationDelay: "-3s" }}>
        <div className="size-3 rounded-full bg-admin-primary" />
      </div>
      <div className="admin-float top-20 right-36" style={{ animationDelay: "-6s" }}>
        <svg viewBox="0 0 40 40" className="size-6 text-admin-primary/70" fill="currentColor">
          <path d="M20 2l5.2 11.6L38 15l-9.4 8.6L31 36l-11-6.4L9 36l2.4-12.4L2 15l12.8-1.4z" />
        </svg>
      </div>
    </div>
  );
}
