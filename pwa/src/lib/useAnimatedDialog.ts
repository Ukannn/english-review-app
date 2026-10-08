import { useCallback, useEffect, useRef, type SyntheticEvent } from "react";

/** Keep native focus/scroll behavior until the surface has finished closing. */
export function useAnimatedDialog(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const callback = useRef(onClose);
  const closing = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  callback.current = onClose;

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    mounted.current = true;
    closing.current = completed.current = false;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      element?.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closing.current || completed.current || !mounted.current) return;
    closing.current = true;
    const finish = () => {
      if (!mounted.current || completed.current) return;
      completed.current = true;
      window.clearTimeout(timer.current);
      callback.current();
    };
    const element = dialog.current;
    if (!element?.open || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    element.dataset.motion = "closing";
    const animations = element.getAnimations?.() ?? [];
    if (!animations.length) {
      finish();
      return;
    }
    // Only this surface (including its backdrop), never animations in its content.
    void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    // An interrupted rendering context must not leave the page scroll-locked.
    timer.current = window.setTimeout(finish, 220);
  }, []);

  const onCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    requestClose();
  }, [requestClose]);
  const onNativeClose = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    // StrictMode can deliver an earlier cleanup close after showModal reopens it.
    if (!event.currentTarget.open) requestClose();
  }, [requestClose]);
  return { dialog, requestClose, onCancel, onNativeClose };
}
