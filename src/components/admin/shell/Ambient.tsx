/**
 * Fixed, non-interactive backdrop behind the whole admin: three slow drifting colour orbs and a faint
 * dot grid. Very low opacity so data stays readable; `PointerFx` nudges it with the cursor. Decorative
 * only (aria-hidden, pointer-events none), and every motion in it stops under reduced motion.
 */
export function Ambient() {
  return (
    <div aria-hidden className="admin-ambient" data-ambient>
      <div className="admin-orb admin-orb-a" />
      <div className="admin-orb admin-orb-b" />
      <div className="admin-orb admin-orb-c" />
      <div className="admin-dots" />
    </div>
  );
}
