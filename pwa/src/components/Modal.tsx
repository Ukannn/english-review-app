import { X } from "lucide-react";
import { type ReactNode } from "react";
import { useAnimatedDialog } from "../lib/useAnimatedDialog";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode | ((close: () => void) => ReactNode); onClose(): void }) {
  const { dialog, requestClose, onCancel, onNativeClose } = useAnimatedDialog(onClose);
  return <dialog ref={dialog} data-motion="entering" className="feedback-dialog" aria-label={title} onCancel={onCancel} onClose={onNativeClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
  }}><div className="dialog-toolbar"><strong>{title}</strong><button className="icon-button" aria-label="关闭反馈" onClick={requestClose}><X size={20}/></button></div>{typeof children === "function" ? children(requestClose) : children}</dialog>;
}
