"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

import { IconButton } from "@/components/ui/Button";

import type { MobileMenu, MenuLink } from "./MobileMenu";

type MenuProps = React.ComponentProps<typeof MobileMenu>;

let loading: Promise<ComponentType<MenuProps>> | null = null;

/** Download the drawer (Radix dialog, focus trap, the link groups). Cached after the first call. */
function loadMenu(): Promise<ComponentType<MenuProps>> {
  loading ??= import("./MobileMenu").then((m) => m.MobileMenu);
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export type { MenuLink };

/**
 * The mobile menu button. Until the first tap it is only the icon button: the drawer code (below `md` only,
 * and only needed when it is used) is a separate chunk that starts downloading on hover, focus or touch. On
 * tap the real menu replaces this button and its own trigger is clicked once, so it opens exactly as before
 * and Radix returns focus to the trigger when it closes.
 */
export function MobileMenuLazy(props: MenuProps) {
  const [menu, setMenu] = useState<{ Menu: ComponentType<MenuProps> } | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const openOnMount = useRef(false);

  useEffect(() => {
    if (!menu || !openOnMount.current) return;
    openOnMount.current = false;
    host.current?.querySelector<HTMLButtonElement>("button")?.click();
  }, [menu]);

  const warm = () => void loadMenu().catch(() => {});
  return (
    <span ref={host} className="contents">
      {menu ? (
        <menu.Menu {...props} />
      ) : (
        <IconButton
          icon="menu"
          label="Open menu"
          className={props.className}
          aria-haspopup="dialog"
          onPointerEnter={warm}
          onFocus={warm}
          onTouchStart={warm}
          onClick={() => {
            loadMenu().then(
              (Menu) => {
                openOnMount.current = true;
                setMenu({ Menu });
              },
              () => {},
            );
          }}
        />
      )}
    </span>
  );
}
