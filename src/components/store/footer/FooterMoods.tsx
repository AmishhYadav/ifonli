import Link from "next/link";

export interface FooterMood {
  slug: string;
  name: string;
}

/** The four moods as 3D keycap buttons (styles in ui.css); each opens that mood's shop page. */
export function FooterMoods({ moods }: { moods: readonly FooterMood[] }) {
  return (
    <ul className="grid max-w-xs grid-cols-2 gap-2.5">
      {moods.map((m) => (
        <li key={m.slug}>
          <Link href={`/vibes/${m.slug}`} className="mood-3d">
            {m.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
