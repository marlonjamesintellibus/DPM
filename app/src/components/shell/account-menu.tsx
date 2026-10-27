"use client";
// The viewer's menu at the foot of the sidebar: the theme, Light, Dark or System. The choice is
// kept in this browser and set on <html data-theme> (globals.css); System follows the computer.
// Below it, "Help improve Atlas" (phase S), which is kept on the server: off deletes what of theirs
// is waiting for the team building DPM (LF2).
import { useEffect, useRef, useState, useTransition } from "react";
import { setHelpImproveAtlasAction, type ActionResult } from "@/app/actions";
import { ActionNote } from "@/components/ui/controls";
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

export function AccountMenu({ helpImproveAtlas = false }: { helpImproveAtlas?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
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
          <p className="border-y border-line px-4 py-2.5 type-label text-fg-2">Atlas</p>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={helpImproveAtlas}
            disabled={pending}
            onClick={() =>
              start(async () => {
                // The page refreshes with the setting as stored
                setResult(await setHelpImproveAtlasAction(!helpImproveAtlas));
              })
            }
            className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-hover disabled:opacity-50"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="type-body-medium text-fg-1">Help improve Atlas</span>
              <span className="type-caption text-fg-3">Let the team building DPM see what Atlas got wrong or could not answer</span>
            </span>
            {helpImproveAtlas && <Icon name="check-14" />}
          </button>
          {result && (
            <div className="px-4 pb-2.5">
              <ActionNote result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
