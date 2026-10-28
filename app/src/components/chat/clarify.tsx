"use client";
// Asking when unsure (conversational plan, phase D, M21). Under Atlas's question, one button per option (at
// most three), each a project or record the author can see. The server checks the option again when it is
// tapped (CL5), so a tap can still be refused; the others then still work. Typing the answer works too (CL2).
import { useState, useTransition } from "react";
import { answerClarificationAction, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

export function ClarifyButtons({ id, options }: { id: string; options: { id: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  if (result?.ok) {
    return (
      <span role="status" className="type-caption text-ok">
        {result.message}
      </span>
    );
  }
  return (
    <span role="group" aria-label="Choose one" className="flex flex-col gap-1.5">
      <span className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button key={o.id} variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await answerClarificationAction(id, o.id)))}>
            {o.label}
          </Button>
        ))}
      </span>
      <ActionNote result={result} />
    </span>
  );
}
