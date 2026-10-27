"use client";
// Phase K, CD13: the project's PM marks it paused (or between phases), so Atlas raises no quiet-project
// signal; the command checks the right, so the button can still be refused.
import { useState, useTransition } from "react";
import { setPausedAction, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

export function PauseControl({ projectId, paused }: { projectId: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex shrink-0 items-center gap-2">
      {paused && <span className="type-caption whitespace-nowrap text-fg-3">Paused: Atlas will not flag it as quiet</span>}
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await setPausedAction(projectId, !paused)))}>
        {paused ? "Resume" : "Mark paused"}
      </Button>
      {result && !result.ok && <ActionNote result={result} />}
    </div>
  );
}
