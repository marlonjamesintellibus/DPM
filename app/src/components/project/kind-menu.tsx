"use client";
// The Kind cell of the BRAID table (L14c, section 13). A PM or Lead opens it to change the kind and
// says why; a member opens it to ask. Each option says what happens to the entry. The command checks
// the right when it runs, so a menu shown here can still be refused, and the answer shows under it.
// It sits inside a row's <summary>, so clicks inside it never open or close the row.
import { useEffect, useRef, useState, useTransition } from "react";
import { askKindAction, switchKindAction, type ActionResult } from "@/app/actions";
import { Icon } from "@/components/shell/icon";
import { ActionNote, Button } from "@/components/ui/controls";
import type { BraidKind } from "@/domain/rights";

export type KindOption = { kind: BraidKind; label: string; hint: string; closes: string };

export function KindMenu({
  entryId,
  version,
  title,
  kindLabel,
  mode,
  options,
}: {
  entryId: string;
  version: number;
  title: string;
  kindLabel: string;
  mode: "switch" | "ask";
  options: KindOption[];
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<BraidKind | null>(null);
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // The table scrolls, so the menu is placed against the window under its button, never clipped by the rows
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const scrolled = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    document.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      document.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);
  const toggle = (button: HTMLButtonElement) => {
    const r = button.getBoundingClientRect();
    setPlace({ top: Math.min(r.bottom + 4, window.innerHeight - 420), left: r.left });
    setOpen(!open);
  };
  const chosen = options.find((o) => o.kind === to);
  const submit = () =>
    chosen &&
    start(async () => {
      const r = mode === "switch" ? await switchKindAction(entryId, version, chosen.kind, why) : await askKindAction(entryId, chosen.kind, why);
      setResult(r);
      if (r.ok) setOpen(false);
    });
  return (
    // Inside the row's <summary>: nothing in here toggles the row
    <div ref={ref} className="relative flex flex-col items-start gap-1" onClick={(e) => e.preventDefault()}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={mode === "switch" ? `${kindLabel}: change kind` : `${kindLabel}: ask to change kind`}
        onClick={(e) => toggle(e.currentTarget)}
        className={`inline-flex items-center gap-1 rounded-sm border py-0.5 pr-1.5 pl-2 type-caption text-fg-1 hover:bg-hover ${open ? "border-accent bg-panel" : "border-line"}`}
      >
        {kindLabel}
        <Icon name="chevron-down-sm" />
      </button>
      {!open && <ActionNote result={result} />}
      {open && place && (
        <div
          role="dialog"
          aria-label={mode === "switch" ? "Change kind" : "Ask to change kind"}
          style={{ top: Math.max(8, place.top), left: place.left }}
          className="fixed z-30 flex w-[300px] cursor-default flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-[0_16px_40px_-4px_rgba(13,18,26,0.16)]"
        >
          <div className="flex flex-col gap-0.5 border-b border-line px-3 pt-2.5 pb-2">
            <span className="type-label text-fg-1">{mode === "switch" ? "Change kind" : "Ask to change kind"}</span>
            <span className="type-caption text-fg-3">{title}</span>
          </div>
          <div role="radiogroup" className="flex flex-col gap-px p-1">
            {options.map((o) => (
              <button
                key={o.kind}
                type="button"
                role="radio"
                aria-checked={to === o.kind}
                onClick={() => setTo(o.kind)}
                className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left ${to === o.kind ? "bg-accent-soft" : "hover:bg-hover"}`}
              >
                <span className="type-caption text-fg-1">{o.label}</span>
                <span className="min-w-0 flex-1 type-micro text-fg-3">{o.hint}</span>
                {to === o.kind && <Icon name="check-13" />}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 border-t border-line px-3 pt-2 pb-3">
            <label className="flex flex-col gap-1.5">
              <span className="type-micro text-fg-3">{mode === "switch" ? "Why (shown on the entry)" : "Why (for the PM or Lead)"}</span>
              <textarea
                value={why}
                rows={2}
                onChange={(e) => setWhy(e.target.value)}
                className="w-full resize-none rounded-sm border border-line-strong bg-panel px-2 py-1.5 type-caption text-fg-1"
              />
            </label>
            {chosen && <p className="type-micro text-fg-3">{mode === "switch" ? chosen.closes : `A PM or Lead decides. Until then it stays ${articled(kindLabel)}.`}</p>}
            <div className="flex gap-1.5 pt-0.5">
              <Button disabled={pending || !chosen || !why.trim()} onClick={submit}>
                {chosen ? (mode === "switch" ? `Switch to ${chosen.label}` : `Ask for ${chosen.label}`) : mode === "switch" ? "Switch" : "Ask"}
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <ActionNote result={result} />
          </div>
        </div>
      )}
    </div>
  );
}

const articled = (label: string) => (/^[aeiou]/i.test(label) ? `an ${label.toLowerCase()}` : `a ${label.toLowerCase()}`);
