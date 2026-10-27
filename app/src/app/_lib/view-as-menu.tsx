"use client";
// View as (L0): the prototype's switch between the seeded people. Each runs everything as that
// person, so the screens show only what their memberships and rights allow.
import { useEffect, useRef, useState, useTransition } from "react";
import { viewAs } from "@/app/actions";
import { Icon } from "@/components/shell/icon";

type Person = { id: string; name: string; initials: string; line: string };

export function ViewAsMenu({ current, label, people }: { current: string; label: string; people: Person[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => [document.removeEventListener("mousedown", close), document.removeEventListener("keydown", esc)].forEach(() => {});
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-[5px] hover:bg-hover"
      >
        <Icon name="eye" />
        <span className="type-label text-fg-1">{pending ? "Switching…" : label}</span>
        <Icon name="chevron-down-sm" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-20 mt-1 w-[340px] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_16px_40px_-4px_rgba(13,18,26,0.16)]">
          <p className="border-b border-line px-4 py-3 type-label text-fg-2">View as</p>
          {people.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={p.id === current}
              type="button"
              onClick={() => start(() => viewAs(p.id))}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-hover"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 type-micro text-fg-2">{p.initials}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="type-body-medium text-fg-1">{p.name}</span>
                <span className="type-caption text-fg-3">{p.line}</span>
              </span>
              {p.id === current && <Icon name="check-14" />}
            </button>
          ))}
          <p className="border-t border-line px-4 py-2.5 type-caption text-fg-3">Prototype only. In the product, Today follows who signs in.</p>
        </div>
      )}
    </div>
  );
}
