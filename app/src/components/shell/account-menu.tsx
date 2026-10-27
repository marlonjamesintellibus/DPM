"use client";
// The viewer's menu at the foot of the sidebar: the theme, Light, Dark or System. The choice is
// kept in this browser and set on <html data-theme> (globals.css); System follows the computer.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

export const THEME_KEY = "dpm-theme";
type Theme = "system" | "light" | "dark";
const CHOICES: { value: Theme; label: string; line: string }[] = [
  { value: "system", label: "System", line: "Follows your computer" },
  { value: "light", label: "Light", line: "Always light" },
  { value: "dark", label: "Dark", line: "Always dark" },
];

function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private windows may refuse storage; the theme still applies until the page reloads
  }
}

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => {
          // Read the theme as the menu opens: the pre-paint script may have set it before React loaded
          const t = document.documentElement.dataset.theme;
          setTheme(t === "light" || t === "dark" ? t : "system");
          setOpen(!open);
        }} className="flex rounded-sm hover:bg-hover">
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-20 mb-1 w-[220px] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_16px_40px_-4px_rgba(13,18,26,0.16)]">
          <p className="border-b border-line px-4 py-2.5 type-label text-fg-2">Theme</p>
          {CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === c.value}
              onClick={() => {
                applyTheme(c.value);
                setTheme(c.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-hover"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="type-body-medium text-fg-1">{c.label}</span>
                <span className="type-caption text-fg-3">{c.line}</span>
              </span>
              {theme === c.value && <Icon name="check-14" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
