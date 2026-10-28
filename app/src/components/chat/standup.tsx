"use client";
// Standup with Atlas (conversational plan, phase J, M28). Under the question waiting, its tap answers as
// buttons, then Skip and That's all; each carries the question's number, so a tap on an earlier question
// changes nothing (rule 6). Typing the answer works too (SU4). The server rebuilds the next question from the
// person's open work when the tap lands (SU8), so the page refreshes with it.
import { useState, useTransition } from "react";
import { answerStandupAction, type ActionResult } from "@/app/actions";
import type { StandupTap } from "@/commands/standup";
import { ActionNote, Button } from "@/components/ui/controls";
import type { TapAnswer } from "@/domain/machines/standup";

export function StandupButtons({ id, n, taps }: { id: string; n: number; taps: { answer: TapAnswer; label: string }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const send = (tap: StandupTap) => start(async () => setResult(await answerStandupAction(id, n, tap)));
  return (
    <span role="group" aria-label="Your answer" className="flex flex-col gap-1.5">
      <span className="flex flex-wrap gap-1.5">
        {taps.map((t) => (
          <Button key={t.answer} variant="secondary" disabled={pending} onClick={() => send({ act: "answer", tap: t.answer })}>
            {t.label}
          </Button>
        ))}
        <Button variant="link" disabled={pending} onClick={() => send({ act: "skip" })}>
          Skip
        </Button>
        <Button variant="link" disabled={pending} onClick={() => send({ act: "stop" })}>
          That&rsquo;s all
        </Button>
      </span>
      {result && !result.ok && <ActionNote result={result} />}
    </span>
  );
}
