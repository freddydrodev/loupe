import { useState } from "react";
import { getStoredTheme, setTheme, type Theme } from "../lib/theme";

/** Switches between the dark and light Lagune themes. */
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(getStoredTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setLocal(next);
  }

  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
