"use client";
// Answering a member's request to change an entry's kind (M17), in the BRAID table and the inbox:
// a PM or Lead switches it or keeps it with a reason; the person who asked can take it back.
import { useState, useTransition } from "react";
import { answerKindAction, withdrawKindAction, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

export function KindRequestControls({ requestId, version, toLabel, mode }: { requestId: string; version: number; toLabel: string; mode: "answer" | "withdraw" }) {
  const [keeping, setKeeping] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  return (
    // Inside a row's <summary>: nothing in here toggles the row
    <div className="flex flex-col gap-1.5" onClick={(e) => e.preventDefault()}>
      {mode === "withdraw" ? (
        <div className="flex">
          <Button variant="secondary" disabled={pending} onClick={() => run(() => withdrawKindAction(requestId))}>
            Withdraw my request
          </Button>
        </div>
      ) : (
        <>
          {keeping && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why it stays as it is"
              aria-label="Why it stays as it is"
              className="w-full max-w-[360px] rounded-sm border border-line-strong bg-panel px-2 py-1 type-caption text-fg-1"
            />
          )}
          <div className="flex gap-1.5">
            <Button disabled={pending} onClick={() => run(() => answerKindAction(requestId, version, { type: "switch" }))}>
              Switch to {toLabel}
            </Button>
            <Button
              variant="secondary"
              disabled={pending || (keeping && !reason.trim())}
              onClick={() => (keeping ? run(() => answerKindAction(requestId, version, { type: "keep", reason })) : setKeeping(true))}
            >
              {keeping ? "Keep, and tell them why" : "Keep as it is"}
            </Button>
          </div>
        </>
      )}
      <ActionNote result={result} />
    </div>
  );
}
