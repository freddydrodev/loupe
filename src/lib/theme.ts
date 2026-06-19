// Theme preference. Stored in localStorage (a non-sensitive UI preference —
// no connection data ever lives here).

export type Theme = "dark" | "light";

const KEY = "lagune-theme";

export function getStoredTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
