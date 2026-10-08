import { Minus, Plus } from "lucide-react";
import { useId } from "react";

export function NumberStepper({ label, value, min, max, disabled = false, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange(value: number): void }) {
  const id = useId();
  return <div className="number-field"><label htmlFor={id}>{label}</label><div className="number-stepper">
    <button type="button" aria-label={`${label}减一`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus size={16}/></button>
    <input id={id} type="number" min={min} max={max} step={1} required disabled={disabled} value={value} onChange={event => onChange(Number(event.target.value))}/>
    <button type="button" aria-label={`${label}加一`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus size={16}/></button>
  </div></div>;
}
