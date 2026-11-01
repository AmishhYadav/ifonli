"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";

interface GalleryZoomProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  count: number;
  zoomed: boolean;
  onToggleZoom: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** The picture, already sized for the zoom state. */
  children: ReactNode;
}

/** The click-to-zoom photo dialog of the gallery, loaded on demand (it carries the whole dialog library). */
export function GalleryZoom({
  open,
  onOpenChange,
  title,
  count,
  zoomed,
  onToggleZoom,
  onPrevious,
  onNext,
  children,
}: GalleryZoomProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        hideTitle
        className="max-w-[min(94vw,52rem)]"
        onKeyDown={(event) => {
          if (count < 2) return;
          if (event.key === "ArrowRight") onNext();
          if (event.key === "ArrowLeft") onPrevious();
        }}
        footer={
          <>
            <Button variant="secondary" onClick={onToggleZoom} aria-pressed={zoomed}>
              {zoomed ? "Zoom out" : "Zoom in"}
            </Button>
            {count > 1 ? (
              <>
                <Button variant="secondary" iconStart="chevron-left" onClick={onPrevious}>
                  Previous
                </Button>
                <Button variant="secondary" iconEnd="chevron-right" onClick={onNext}>
                  Next
                </Button>
              </>
            ) : null}
          </>
        }
      >
        <div
          tabIndex={0}
          role="group"
          aria-label="Photo, scroll to pan when zoomed in"
          className="max-h-[65dvh] overflow-auto rounded-card bg-surface-2"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
