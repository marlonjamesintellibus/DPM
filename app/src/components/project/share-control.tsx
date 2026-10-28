"use client";
// Phase G (conversational plan, section 9): the project's PM shares the status on show, and its reason, with the
// client, so a client status Atlas drafts may say them; otherwise it holds only the releases (DR4). The command
// checks the right, and that the reason is still the one on show, so the button can still be refused.
import { useState, useTransition } from "react";
import { shareReasonAction, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

export function ShareStatusControl({ projectId, reasonId, shared }: { projectId: string; reasonId: string; shared: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex shrink-0 items-center gap-2">
      {shared && <span className="type-caption whitespace-nowrap text-fg-3">Status shared with the client</span>}
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await shareReasonAction(projectId, reasonId, !shared)))}>
        {shared ? "Stop sharing" : "Share status with client"}
      </Button>
      {result && !result.ok && <ActionNote result={result} />}
    </div>
  );
}
