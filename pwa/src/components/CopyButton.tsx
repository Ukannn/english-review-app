import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { useActionFeedback } from "../lib/useActionFeedback";

export function CopyButton({ text, label, disabled, className, onCopied, onError }: { text: string; label: string; disabled?: boolean; className?: string; onCopied(): void; onError(): void }) {
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const currentText = useRef(text);
  currentText.current = text;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(feedback.reset, [text, feedback.reset]);
  async function copy() {
    if (locked.current) return;
    locked.current = true; feedback.reset(); setPending(true);
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current && currentText.current === text) { feedback.confirm(); onCopied(); }
    } catch {
      if (mounted.current && currentText.current === text) onError();
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return <ActionButton label={label} pendingLabel="正在复制…" successLabel="已复制" icon={Copy} pending={pending} success={feedback.success} disabled={disabled} className={className} onClick={() => void copy()}/>;
}
