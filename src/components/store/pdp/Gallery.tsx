"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button, Dialog, DialogContent, Icon, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

import { usePurchase } from "./PurchaseProvider";
import { imageIndexForVariant, type PdpImage } from "./product-model";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Picture({
  image,
  sizes,
  priority,
  className,
}: {
  image: PdpImage;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={image.src}
      alt={image.alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn(image.isCutout ? "object-contain p-[10%]" : "object-cover", className)}
    />
  );
}

/**
 * Product gallery: square slides in a scroll-snap strip (native touch swipe), previous / next buttons,
 * arrow keys on the strip, thumbnails, and a click-to-open zoom dialog. Every slide is the same square so
 * switching images never moves the page. A variant that has its own photo brings it into view.
 */
export function Gallery({ images, productName }: { images: PdpImage[]; productName: string }) {
  const { variantId } = usePurchase();
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const count = images.length;

  const goTo = useCallback(
    (next: number, behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth") => {
      const el = strip.current;
      if (!el || count === 0) return;
      const i = (next + count) % count;
      el.scrollTo({ left: i * el.clientWidth, behavior });
      setIndex(i);
    },
    [count],
  );

  // Keep `index` in step with a swipe: the strip's scroll position is the source of truth.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // A variant with its own image jumps to it (instantly: the shopper just changed an option).
  useEffect(() => {
    const target = imageIndexForVariant(images, variantId);
    if (target !== null) goTo(target, "auto");
  }, [variantId, images, goTo]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    }
  };

  if (count === 0) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-card border-token bg-surface-2 text-ink-muted">
        <Icon name="image" className="size-16" />
        <span className="sr-only">No photo yet</span>
      </div>
    );
  }

  const current = images[Math.min(index, count - 1)]!;
  const navButton =
    "absolute top-1/2 z-10 -translate-y-1/2 border-token bg-surface/90 hover:bg-surface max-md:hidden";

  return (
    <section aria-label={`${productName} photos`} className="flex flex-col gap-3" data-testid="gallery">
      <div className="relative">
        <div
          ref={strip}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${productName} photos. Use the arrow keys to move between photos.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className={cn(
            "flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-card border-token bg-surface-2",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {images.map((image, i) => (
            <div
              key={image.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`Photo ${i + 1} of ${count}`}
              className="relative aspect-square w-full flex-none snap-center"
            >
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setZoomed(false);
                  setZoomOpen(true);
                }}
                aria-label={`Open photo ${i + 1} larger`}
                tabIndex={i === Math.min(index, count - 1) ? 0 : -1}
                className="absolute inset-0 cursor-zoom-in"
              >
                <Picture
                  image={image}
                  priority={i === 0}
                  sizes="(min-width: 1440px) 680px, (min-width: 1024px) 48vw, 100vw"
                />
              </button>
            </div>
          ))}
        </div>
        {count > 1 ? (
          <>
            <IconButton
              icon="chevron-left"
              label="Previous photo"
              className={cn(navButton, "left-2")}
              onClick={() => goTo(index - 1)}
            />
            <IconButton
              icon="chevron-right"
              label="Next photo"
              className={cn(navButton, "right-2")}
              onClick={() => goTo(index + 1)}
            />
            <p
              aria-hidden="true"
              className="pointer-events-none absolute right-2 bottom-2 rounded-button border-token bg-surface px-2.5 py-0.5 text-sm font-semibold tabular-nums"
            >
              {Math.min(index, count - 1) + 1} / {count}
            </p>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Choose a photo">
          {images.map((image, i) => {
            const active = i === Math.min(index, count - 1);
            return (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Show photo ${i + 1} of ${count}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative block size-16 overflow-hidden rounded-input border-token bg-surface-2 sm:size-[4.5rem]",
                    active ? "shadow-button" : "opacity-70 hover:opacity-100",
                  )}
                >
                  <Image
                    src={image.src}
                    alt=""
                    fill
                    sizes="72px"
                    className={image.isCutout ? "object-contain p-1.5" : "object-cover"}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent
          title={`${productName}, photo ${Math.min(index, count - 1) + 1} of ${count}`}
          hideTitle
          className="max-w-[min(94vw,52rem)]"
          onKeyDown={(event) => {
            if (count < 2) return;
            if (event.key === "ArrowRight") goTo(index + 1, "auto");
            if (event.key === "ArrowLeft") goTo(index - 1, "auto");
          }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed}>
                {zoomed ? "Zoom out" : "Zoom in"}
              </Button>
              {count > 1 ? (
                <>
                  <Button variant="secondary" iconStart="chevron-left" onClick={() => goTo(index - 1, "auto")}>
                    Previous
                  </Button>
                  <Button variant="secondary" iconEnd="chevron-right" onClick={() => goTo(index + 1, "auto")}>
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
            className="max-h-[65dvh] overflow-auto rounded-card border border-border bg-surface-2"
          >
            <div
              className="relative aspect-square max-w-none transition-[width] ease-vibe"
              style={{ width: zoomed ? "200%" : "100%" }}
            >
              <Picture image={current} sizes="(min-width: 1024px) 1600px, 188vw" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
