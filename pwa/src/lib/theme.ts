export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "english-lab-theme";
export const THEME_EVENT = "english-lab-theme-change";
let sessionPreference: ThemePreference = "system";
export function readThemePreference(): ThemePreference {
  try { const value = localStorage.getItem(THEME_STORAGE_KEY); if (value === "light" || value === "dark" || value === "system") return value; } catch { return sessionPreference; }
  return "system";
}
export function setThemePreference(preference: ThemePreference) {
  sessionPreference = preference;
  try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Keep the session preference. */ }
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: preference }));
}
export function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.resolvedTheme = dark ? "dark" : "light";
  document.documentElement.dataset.palette = "ink";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#17181b" : "#f7f8fa");
}
