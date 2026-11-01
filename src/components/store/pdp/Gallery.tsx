"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { IconButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

import { usePurchase } from "./PurchaseProvider";
import { galleryOrder, imageIndexForVariant, type PdpImage } from "./product-model";

const GalleryZoom = dynamic(() => import("./GalleryZoom").then((m) => m.GalleryZoom), { ssr: false });

/** Static class names: the tile sits on the product's own vibe gradient (neutral when it has none). */
const ART: Record<string, string> = {
  cute: "art-cute",
  funky: "art-funky",
  bold: "art-bold",
  gothic: "art-gothic",
};
const artClass = (vibe: string | null | undefined) => (vibe ? ART[vibe] : undefined) ?? "art-none";

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
      // The first slide is the LCP image: eager + high fetch priority (Next 16 deprecates `priority` for
      // `preload`, but its docs steer responsive, multi-image cases to `loading` / `fetchPriority`).
      loading={priority ? "eager" : undefined}
      fetchPriority={priority ? "high" : undefined}
      className={cn(image.isCutout ? "object-contain p-[10%]" : "object-cover", className)}
    />
  );
}

/**
 * Product gallery: the cutout leads (on the product's vibe gradient), then the photos. Square slides in a
 * scroll-snap strip (native touch swipe), previous / next buttons, arrow keys on the strip, thumbnails, and a
 * click-to-open zoom dialog. Every slide is the same square so switching images never moves the page. A variant
 * that has its own photo brings it into view.
 */
export function Gallery({
  images: imagesInBuildOrder,
  productName,
  primaryVibe,
}: {
  images: PdpImage[];
  productName: string;
  /** The product's main vibe: picks the tile's art gradient. */
  primaryVibe?: string | null;
}) {
  const art = artClass(primaryVibe);
  const images = useMemo(() => galleryOrder(imagesInBuildOrder), [imagesInBuildOrder]);
  const { variantId } = usePurchase();
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  // The zoom dialog (and the dialog library behind it) is only downloaded once a photo has been opened.
  const [zoomEver, setZoomEver] = useState(false);
  if (zoomOpen && !zoomEver) setZoomEver(true);
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
      <div className={cn("grid aspect-square w-full place-items-center rounded-card text-ink-muted", art)}>
        <Icon name="image" className="size-16" />
        <span className="sr-only">No photo yet</span>
      </div>
    );
  }

  const current = images[Math.min(index, count - 1)]!;
  const navButton =
    "absolute top-1/2 z-10 -translate-y-1/2 bg-surface/80 shadow-card backdrop-blur-sm hover:bg-surface max-md:hidden";

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
            "flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-card",
            art,
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {images.map((image, i) => (
            <div
              key={image.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`Photo ${i + 1} of ${count}`}
              data-fly-source={i === Math.min(index, count - 1) ? "" : undefined}
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
              className="pointer-events-none absolute right-3 bottom-3 rounded-button bg-surface/80 px-3 py-0.5 text-sm font-semibold tabular-nums backdrop-blur-sm"
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
              <li key={image.id} className="flex flex-col items-center gap-1.5">
                {/* Selected = lifted (bigger, soft shadow, full strength) with a small pill under it: no hard ring,
                    and the cue is shape and size as well as colour. */}
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Show photo ${i + 1} of ${count}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative block size-16 overflow-hidden rounded-input transition-[opacity,box-shadow,transform] ease-vibe sm:size-[4.5rem]",
                    art,
                    active ? "scale-105 opacity-100 shadow-card" : "opacity-60 hover:opacity-100",
                  )}
                >
                  <Image
                    src={image.src}
                    alt=""
                    fill
                    sizes="72px"
                    // Eager but low priority: the thumbnail shares its default `src` URL with the slide of the
                    // same photo, and Next's dev LCP check keys on that URL, so a lazy thumbnail would make the
                    // eager LCP slide look lazy to it. The thumbnails are tiny and sit right under the photo.
                    loading="eager"
                    fetchPriority="low"
                    className={image.isCutout ? "object-contain p-1.5" : "object-cover"}
                  />
                </button>
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1 w-6 rounded-full bg-accent transition-opacity ease-vibe",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {zoomEver ? (
        <GalleryZoom
          open={zoomOpen}
          onOpenChange={setZoomOpen}
          title={`${productName}, photo ${Math.min(index, count - 1) + 1} of ${count}`}
          count={count}
          zoomed={zoomed}
          onToggleZoom={() => setZoomed((z) => !z)}
          onPrevious={() => goTo(index - 1, "auto")}
          onNext={() => goTo(index + 1, "auto")}
        >
          <div
            className={cn("relative aspect-square max-w-none transition-[width] ease-vibe", art)}
            style={{ width: zoomed ? "200%" : "100%" }}
          >
            <Picture image={current} sizes="(min-width: 1024px) 1600px, 188vw" />
          </div>
        </GalleryZoom>
      ) : null}
    </section>
  );
}
