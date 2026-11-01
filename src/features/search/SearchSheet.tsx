"use client";

import { useState, type ComponentType } from "react";

import { IconButton } from "@/components/ui/Button";

import type { SearchSheetProps, SearchShortcut } from "./SearchSheetPanel";

export type { SearchShortcut };

let loading: Promise<ComponentType<SearchSheetProps>> | null = null;

/** Download the search dialog (Radix dialog, results list, the search Server Action). Cached after the first call. */
function loadPanel(): Promise<ComponentType<SearchSheetProps>> {
  loading ??= import("./SearchSheetPanel").then((m) => m.SearchSheetPanel);
  loading.catch(() => {
    loading = null; // offline or a failed chunk: the next click tries again
  });
  return loading;
}

/**
 * Header search entry. Until the first click it is just the icon button: the dialog, its focus trap and the
 * results list are a separate chunk that starts downloading on hover, focus or touch and mounts already open
 * on click (`SearchSheetPanel` renders the same button as its trigger, so focus return keeps working).
 */
export function SearchSheet({ shortcuts }: Pick<SearchSheetProps, "shortcuts">) {
  const [panel, setPanel] = useState<{ Panel: ComponentType<SearchSheetProps> } | null>(null);
  if (panel) return <panel.Panel shortcuts={shortcuts} defaultOpen />;

  const warm = () => void loadPanel().catch(() => {});
  return (
    <IconButton
      icon="search"
      label="Search"
      aria-haspopup="dialog"
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onClick={() => {
        loadPanel().then((Panel) => setPanel({ Panel }), () => {});
      }}
    />
  );
}
