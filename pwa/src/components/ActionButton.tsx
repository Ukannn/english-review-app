import { Check, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  pendingLabel?: string;
  successLabel?: string;
  pending?: boolean;
  success?: boolean;
  icon?: LucideIcon;
};

/** All three layers share a grid cell, reserving the widest label without hiding the button. */
export function ActionButton({ label, pendingLabel = "正在保存…", successLabel = "已保存", pending = false, success = false, icon: Icon, className = "primary-button", disabled, type = "button", ...props }: Props) {
  const state = pending ? "pending" : success ? "success" : "idle";
  return <button {...props} type={type} className={`${className} action-button`} disabled={disabled || pending} aria-label={state === "pending" ? pendingLabel : state === "success" ? successLabel : label} aria-busy={pending} data-action-state={state}>
    <span className="action-button__layers" aria-hidden="true">
      <span className="action-button__layer" data-state="idle">{Icon && <Icon size={17}/>}<span>{label}</span></span>
      <span className="action-button__layer" data-state="pending"><span className="action-button__spinner"><LoaderCircle size={17}/></span><span>{pendingLabel}</span></span>
      <span className="action-button__layer" data-state="success"><Check size={17}/><span>{successLabel}</span></span>
    </span>
  </button>;
}
