"use client";
// A conversation's own menu in the list (M18, section 16): rename it, archive it, or bring it back.
// Archiving changes nothing in it (CV13); an archived conversation the viewer had open leaves the screen.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveConversationAction, renameConversationAction, restoreConversationAction, type ActionResult } from "@/app/actions";
import { Icon } from "@/components/shell/icon";
import { ActionNote, Button } from "@/components/ui/controls";

export function ConversationMenu({ id, title, archived, open }: { id: string; title: string; archived: boolean; open: boolean }) {
  const router = useRouter();
  const [shown, setShown] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setShown(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [shown]);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        setShown(false);
        setRenaming(false);
        after?.();
      }
    });
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown(!shown)} className="flex rounded-sm p-0.5 hover:bg-panel">
        <Icon name="more" />
      </button>
      {shown && (
        <div role="menu" className="absolute top-full right-0 z-20 mt-1 flex w-[240px] flex-col gap-1 rounded-lg border border-line bg-panel p-1.5 shadow-[0_16px_40px_-4px_rgba(13,18,26,0.16)]">
          {renaming ? (
            <form
              className="flex flex-col gap-1.5 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => renameConversationAction(id, name));
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Conversation title" maxLength={80} className="rounded-sm border border-line-strong bg-panel px-2 py-1 type-caption text-fg-1" />
              <div className="flex gap-1.5">
                <Button type="submit" disabled={pending || !name.trim()}>
                  Rename
                </Button>
                <Button variant="secondary" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => setRenaming(true)} className="rounded-sm px-2 py-1.5 text-left type-caption text-fg-1 hover:bg-hover">
                Rename
              </button>
              {archived ? (
                <button type="button" role="menuitem" disabled={pending} onClick={() => run(() => restoreConversationAction(id))} className="rounded-sm px-2 py-1.5 text-left type-caption text-fg-1 hover:bg-hover">
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending}
                  onClick={() => run(() => archiveConversationAction(id), () => open && router.push("/?view=chat"))}
                  className="rounded-sm px-2 py-1.5 text-left type-caption text-fg-1 hover:bg-hover"
                >
                  Archive
                </button>
              )}
            </>
          )}
          <ActionNote result={result} />
        </div>
      )}
    </div>
  );
}
