"use client";
// A check-in on the viewer's own promise (conversational plan, phase E, M22), in their chat and their inbox: Done,
// a new date, or Drop; or, when its work was cancelled (CM11), "It still stands" or Drop. The server checks the
// promise is theirs and still live when a button is pressed, so a second tap is refused and changes nothing.
// Typing the answer in the chat works too ("done", "drop it", "Friday").
import { useState, useTransition } from "react";
import { answerCommitmentAction, type ActionResult } from "@/app/actions";
import type { CheckInAnswer } from "@/commands/commitment";
import { ActionNote, Button } from "@/components/ui/controls";

export function CommitmentButtons({ id, mode, today, dropFirst = false }: { id: string; mode: "check" | "stands"; today: string; dropFirst?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [day, setDay] = useState("");
  const [picking, setPicking] = useState(false);
  const send = (answer: CheckInAnswer) => start(async () => setResult(await answerCommitmentAction(id, answer)));
  if (result?.ok) {
    return (
      <span role="status" className="type-caption text-ok">
        {result.message}
      </span>
    );
  }
  // CD24: after 3 moves the check-in asks whether to drop it, so Drop comes first
  const drop = (
    <Button key="drop" variant={dropFirst ? "primary" : "secondary"} disabled={pending} onClick={() => send({ act: "drop" })}>
      Drop it
    </Button>
  );
  return (
    <span role="group" aria-label="Your promise" className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        {dropFirst && drop}
        {mode === "check" ? (
          <>
            <Button variant={dropFirst ? "secondary" : "primary"} disabled={pending} onClick={() => send({ act: "done" })}>
              Done
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setPicking(!picking)}>
              New date
            </Button>
          </>
        ) : (
          <Button disabled={pending} onClick={() => send({ act: "keep" })}>
            It still stands
          </Button>
        )}
        {!dropFirst && drop}
      </span>
      {picking && (
        <span className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            aria-label="New date"
            min={today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-control border border-line-strong bg-panel px-2 py-1 type-body"
          />
          <Button variant="secondary" disabled={pending || !day} onClick={() => send({ act: "date", dueOn: day })}>
            Move it
          </Button>
        </span>
      )}
      <ActionNote result={result} />
    </span>
  );
}
