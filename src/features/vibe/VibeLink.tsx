"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import type { Vibe } from "./config";
import { switchVibeTo } from "./switch";

type Props = Omit<ComponentProps<typeof Link>, "href"> & {
  /** The vibe this link belongs to; clicking wears it and then opens `href`. */
  vibe: Vibe;
  href: string;
};

/**
 * A link to a vibe's collection that also switches the whole site to that vibe (hand-style: font warm-up,
 * view transition, the hand flips). It stays a real `<a href>`, so middle-click, "open in new tab" and
 * crawlers work; only a plain left click is intercepted.
 */
export function VibeLink({ vibe, href, onClick, ...rest }: Props) {
  const router = useRouter();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const plain =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    const target = event.currentTarget.getAttribute("target");
    if (!plain || (target && target !== "_self")) return;
    event.preventDefault();
    void switchVibeTo(vibe, "nav", { navigate: () => router.push(href) });
  };

  return <Link href={href} onClick={handleClick} {...rest} />;
}
