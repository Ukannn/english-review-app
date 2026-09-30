import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const original = document.body.style.overflow;
    const element = dialog.current;
    document.body.style.overflow = "hidden"; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = original; returnTo?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="feedback-dialog" aria-label={title} onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><div className="dialog-toolbar"><strong>{title}</strong><button autoFocus className="icon-button" aria-label="关闭反馈" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
