"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

import { placeFloating, type Side } from "./floating";

interface HoverCardProps {
  /** One focusable element (a link or a button). It is the anchor and gets aria-describedby while the card is open. */
  children: ReactNode;
  content: ReactNode;
  /** Preferred side; the card flips when it does not fit and is always kept inside the viewport. */
  side?: Side;
  /** Delay before opening on hover, in ms. Keyboard focus opens at once. */
  delay?: number;
  /** "card" for rich content (a quote summary), "tooltip" for one short line. */
  variant?: "card" | "tooltip";
  disabled?: boolean;
  className?: string;
}

/**
 * Positioned card on hover and keyboard focus, without a library. The trigger stays in place (a display:contents
 * wrapper listens for its events); the card renders in a portal so overflow:hidden parents such as the heatmap cannot
 * clip it, flips and clamps to the viewport, is linked to the trigger with aria-describedby, stays open while the
 * pointer is over it, and closes on Escape, blur or pointer leave (WCAG 1.4.13).
 */
export function HoverCard({ children, content, side = "bottom", delay = 200, variant = "card", disabled = false, className }: HoverCardProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const schedule = (next: boolean, wait: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), wait);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Describe the trigger by the card while it is open.
  useEffect(() => {
    const trigger = wrapperRef.current?.firstElementChild;
    if (!open || !trigger) return;
    const before = trigger.getAttribute("aria-describedby");
    trigger.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      if (before) trigger.setAttribute("aria-describedby", before);
      else trigger.removeAttribute("aria-describedby");
    };
  }, [open, id]);

  // Position before paint, then follow scrolling and resizing while open.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = wrapperRef.current?.firstElementChild;
      const card = cardRef.current;
      if (!trigger || !card) return;
      const anchor = trigger.getBoundingClientRect();
      const position = placeFloating(
        { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height },
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        side,
      );
      card.style.transform = `translate(${Math.round(position.x)}px, ${Math.round(position.y)}px)`;
      card.dataset.side = position.side;
    };
    place();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, side, content]);

  const onFocus = (event: FocusEvent<HTMLSpanElement>) => {
    // Only keyboard focus opens the card; a click that focuses a button should not pop it up.
    if (!disabled && event.target instanceof HTMLElement && event.target.matches(":focus-visible")) schedule(true, 0);
  };

  return (
    <>
      <span
        ref={wrapperRef}
        className="contents"
        onMouseEnter={() => !disabled && schedule(true, delay)}
        onMouseLeave={() => schedule(false, 100)}
        onFocus={onFocus}
        onBlur={() => schedule(false, 0)}
      >
        {children}
      </span>
      {open && !disabled
        ? createPortal(
            <div
              ref={cardRef}
              id={id}
              role="tooltip"
              onMouseEnter={() => window.clearTimeout(timer.current)}
              onMouseLeave={() => schedule(false, 100)}
              style={{ position: "fixed", top: 0, left: 0 }}
              className={cn(
                "z-[70] rounded-xs border border-line-2 bg-panel-2 text-fg shadow-xl",
                variant === "tooltip" ? "max-w-64 px-2 py-1 text-xs" : "w-72 max-w-[calc(100vw-1rem)] p-3 text-sm",
                className,
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** One short line of help on hover and keyboard focus, e.g. the name behind a function code. */
export function Tooltip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: Side }) {
  return (
    <HoverCard content={label} side={side} delay={400} variant="tooltip">
      {children}
    </HoverCard>
  );
}
