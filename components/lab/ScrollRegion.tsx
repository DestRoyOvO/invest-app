"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontal scroll container for a wide table. When its content overflows it becomes a named, focusable region, so
 * keyboard users can scroll it with the arrow keys (WCAG 2.1.1); when everything fits it is a plain wrapper and adds
 * no tab stop. Pass the table with its own scroll wrapper turned off (DataTable className "overflow-x-visible!").
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role={overflowing ? "region" : undefined}
      aria-label={overflowing ? label : undefined}
      tabIndex={overflowing ? 0 : undefined}
      className="overflow-x-auto focus-visible:outline-offset-[-2px]"
    >
      {children}
    </div>
  );
}
