"use client";
// A draft in the chat (conversational plan, phase G, M25): the words Atlas wrote from DPM's facts, in a box the
// person edits, with Copy, Refresh and Discard. Copy sends the words on screen to the server, which checks
// them (a client status against the client view now, DR4) and gives back what goes on the clipboard; Refresh
// drafts again from the facts now, their words kept aside (DR5); a refusal offers Refresh. Edits are kept with
// the draft when the box loses focus, so a reload shows them. Nothing is posted: posting waits on B8 and B9.
import { useState, useTransition } from "react";
import { copyDraftAction, discardDraftAction, editDraftAction, refreshDraftAction, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

export function DraftEditor({ id, text, label }: { id: string; text: string; label: string }) {
  const [words, setWords] = useState(text);
  const [saved, setSaved] = useState(text);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [refusedCopy, setRefusedCopy] = useState(false);
  const act = (work: () => Promise<ActionResult>) => start(async () => setResult(await work()));
  const copy = () =>
    start(async () => {
      const r = await copyDraftAction(id, words);
      if (r.ok && r.text !== undefined) {
        await navigator.clipboard.writeText(r.text).catch(() => undefined);
        setResult({ ok: true, message: "Copied." });
      } else setResult(r);
      setRefusedCopy(!r.ok);
    });
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label={`Your ${label}`}
        value={words}
        onChange={(e) => setWords(e.target.value)}
        onBlur={(e) => {
          // Copy and Refresh send the words themselves; saving here too would race them
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-draft-tools]")) return;
          if (words.trim() && words !== saved) act(async () => {
            const r = await editDraftAction(id, words);
            if (r.ok) setSaved(words);
            return r.ok ? { ok: true } : r;
          });
        }}
        rows={Math.min(14, Math.max(5, words.split("\n").length + 1))}
        className="w-full resize-y rounded-panel border border-line bg-panel px-3 py-2.5 type-body text-fg-1 outline-none focus:ring-2 focus:ring-accent"
      />
      <span data-draft-tools className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !words.trim()} onClick={copy}>
          Copy
        </Button>
        <Button variant={refusedCopy ? "primary" : "secondary"} disabled={pending} onClick={() => act(() => refreshDraftAction(id, words))}>
          Refresh
        </Button>
        <Button variant="link" disabled={pending} onClick={() => act(() => discardDraftAction(id))}>
          Discard
        </Button>
      </span>
      <ActionNote result={result} />
    </div>
  );
}
