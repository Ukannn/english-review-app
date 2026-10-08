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
    pill.style.width = `${selected.offsetWidth}px`;
    pill.style.height = `${selected.offsetHeight}px`;
    pill.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
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
