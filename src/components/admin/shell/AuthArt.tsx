/**
 * Abstract artwork behind the sign-in screen: slowly turning dashed rings and a few floating shapes
 * in the logo's colours, on top of the (stronger) ambient orbs. Decorative; static under reduced motion.
 */
export function AuthArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="admin-ring-art top-1/2 left-1/2 size-[68vmin] -translate-x-1/2 -translate-y-1/2" />
      <div
        className="admin-ring-art top-1/2 left-1/2 size-[96vmin] -translate-x-1/2 -translate-y-1/2"
        style={{ animationDirection: "reverse", animationDuration: "140s" }}
      />
      <div className="admin-float top-[14%] left-[12%]" style={{ animationDelay: "-2s" }}>
        <div className="size-14 rotate-12 rounded-2xl bg-admin-coral/70 shadow-lg" />
      </div>
      <div className="admin-float top-[22%] right-[14%]" style={{ animationDelay: "-5s" }}>
        <div className="size-10 rounded-full bg-admin-butter shadow-md" />
      </div>
      <div className="admin-float bottom-[16%] left-[18%] hidden sm:block" style={{ animationDelay: "-7s" }}>
        <div className="size-8 rounded-full border-4 border-admin-peach" />
      </div>
      <div className="admin-float right-[20%] bottom-[20%] hidden sm:block" style={{ animationDelay: "-3s" }}>
        <svg viewBox="0 0 40 40" className="size-12 text-admin-butter" fill="currentColor">
          <path d="M20 2l5.2 11.6L38 15l-9.4 8.6L31 36l-11-6.4L9 36l2.4-12.4L2 15l12.8-1.4z" />
        </svg>
      </div>
    </div>
  );
}
