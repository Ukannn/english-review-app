import { useLayoutEffect, useRef, type ReactNode } from "react";

/** A decorative moving surface; existing buttons own selection and keyboard input. */
export function SegmentedControl({ label, children }: { label: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const frame = useRef<number | undefined>(undefined);

  function measure(animate: boolean) {
    const element = root.current;
    const pill = indicator.current;
    const selected = element?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!element || !pill || !selected || !selected.offsetWidth) return;
    if (!animate) {
      element.dataset.motionReady = "false";
      window.cancelAnimationFrame(frame.current ?? 0);
    }
    const nextCenter = selected.offsetLeft + selected.offsetWidth / 2;
    const previousCenter = element.dataset.measured === "true" ? pill.offsetLeft + pill.offsetWidth / 2 : nextCenter;
    element.dataset.direction = nextCenter >= previousCenter ? "right" : "left";
    // Cap stretching on long jumps and rapid reversals instead of stretching across every skipped tab.
    pill.style.setProperty("--edge-lag", `${Math.min(18, 1000 / Math.max(1, Math.abs(nextCenter - previousCenter)))}ms`);
    // The leading edge moves first; the trailing edge catches up without distorting text.
    pill.style.left = `${selected.offsetLeft}px`;
    pill.style.right = `${element.clientWidth - selected.offsetLeft - selected.offsetWidth}px`;
    pill.style.height = `${selected.offsetHeight}px`;
    pill.style.top = `${selected.offsetTop}px`;
    element.dataset.measured = "true";
    if (!animate) {
      // Commit initial/resize geometry before enabling the next selection tween.
      void pill.offsetWidth;
      frame.current = window.requestAnimationFrame(() => { element.dataset.motionReady = "true"; });
    }
  }

  useLayoutEffect(() => { measure(root.current?.dataset.measured === "true"); });
  useLayoutEffect(() => {
    const element = root.current;
    let width = 0;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (!element) return;
      measure(width === element.clientWidth);
      width = element.clientWidth;
    });
    if (element) {
      observer?.observe(element);
      element.querySelectorAll("button").forEach(button => observer?.observe(button));
    }
    return () => { observer?.disconnect(); window.cancelAnimationFrame(frame.current ?? 0); };
  }, []);

  return <div ref={root} className="segmented-control segmented-control--motion" role="group" aria-label={label}>
    <span ref={indicator} className="segmented-control__indicator" aria-hidden="true"/>
    {children}
  </div>;
}
