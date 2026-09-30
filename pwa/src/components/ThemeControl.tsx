import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, readThemePreference, setThemePreference, THEME_EVENT, THEME_STORAGE_KEY, type ThemePreference } from "../lib/theme";

export function ThemeControl() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    applyTheme(preference);
    const system = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => applyTheme(preference);
    system?.addEventListener("change", update);
    const sync = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY) setPreference(readThemePreference()); };
    const sessionSync = (event: Event) => setPreference((event as CustomEvent<ThemePreference>).detail);
    window.addEventListener("storage", sync);
    window.addEventListener(THEME_EVENT, sessionSync);
    return () => { system?.removeEventListener("change", update); window.removeEventListener("storage", sync); window.removeEventListener(THEME_EVENT, sessionSync); };
  }, [preference]);
  return <div className="theme-control"><span>外观</span><div className="segmented-control" aria-label="页面外观">{([{ value: "light", label: "浅色", icon: Sun }, { value: "dark", label: "深色", icon: Moon }, { value: "system", label: "系统", icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button key={value} className={preference === value ? "is-active" : ""} aria-pressed={preference === value} onClick={() => setThemePreference(value)}><Icon size={15}/>{label}</button>)}</div></div>;
}
