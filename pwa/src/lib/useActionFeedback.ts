import { useCallback, useEffect, useRef, useState } from "react";

/** Brief confirmation after a real operation succeeds; new edits clear it immediately. */
export function useActionFeedback() {
  const [success, setSuccess] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    setSuccess(false);
  }, []);
  const confirm = useCallback(() => {
    if (!mounted.current) return;
    window.clearTimeout(timer.current);
    setSuccess(true);
    timer.current = window.setTimeout(() => setSuccess(false), 2400);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; window.clearTimeout(timer.current); };
  }, []);
  return { success, confirm, reset };
}
