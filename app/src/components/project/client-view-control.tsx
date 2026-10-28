"use client";
// Decision CD49: the project's PM turns an outside contact's client view on or off; the command checks the
// right when it runs, so the button can still be refused (a PM who left, a member who is not the PM).
import { useState, useTransition } from "react";
import { setClientViewAction, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

export function ClientViewControl({ projectId, personId, firstName, on }: { projectId: string; personId: string; firstName: string; on: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        variant="secondary"
        aria-label={`${on ? "Turn off" : "Turn on"} ${firstName}'s client view`}
        disabled={pending}
        onClick={() => start(async () => setResult(await setClientViewAction(projectId, personId, !on)))}
      >
        {on ? "Turn off" : "Turn on"}
      </Button>
      {result && !result.ok && <ActionNote result={result} />}
    </div>
  );
}
