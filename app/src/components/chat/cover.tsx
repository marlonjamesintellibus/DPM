"use client";
// Cover while away (conversational plan, phase P, M35). Under the message that said the leave: for one project's
// things still free, tick what to ask about (one or several, LV8), pick a teammate, and ask; each teammate shows only
// what phase H's rule lets the person see (CD9), and one the project shows away then cannot be picked (LV2). Only this
// tap sends the ask (rule 9); the form carries one command id, so a second tap asks once (rule 6). "No cover needed"
// ends Atlas's offer. For the teammate asked, in their chat and inbox: Accept, can't, or can't do one of several.
import { useState, useTransition } from "react";
import { answerCoverAction, askCoverAction, dismissCoverAction, type ActionResult } from "@/app/actions";
import type { CoverAnswer } from "@/commands/cover";
import { ActionNote, Button } from "@/components/ui/controls";

type Thing = { key: string; label: string; when: string };
type Teammate = { id: string; name: string; facts: string; away: string | null };

export function AskCover({ leaveId, projectName, things, teammates }: { leaveId: string; projectName: string; things: Thing[]; teammates: Teammate[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [picked, setPicked] = useState<string[]>(things.map((t) => t.key));
  const [who, setWho] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  if (result?.ok) {
    return (
      <span role="status" className="type-caption text-ok">
        {result.message}
      </span>
    );
  }
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  return (
    <fieldset aria-label={`Ask cover on ${projectName}`} className="flex flex-col gap-2 rounded-md bg-panel-2 p-3">
      <legend className="sr-only">Ask cover on {projectName}</legend>
      <span className="type-caption text-fg-3">On {projectName}</span>
      {things.map((t) => (
        <label key={t.key} className="flex items-center gap-2 type-body text-fg-1">
          <input type="checkbox" checked={picked.includes(t.key)} onChange={() => toggle(t.key)} />
          <span>
            {t.label} <span className="type-caption text-fg-3">{t.when}</span>
          </span>
        </label>
      ))}
      {teammates.length ? (
        <span className="flex flex-wrap items-center gap-2">
          <select aria-label="Who to ask" value={who} onChange={(e) => setWho(e.target.value)} className="min-w-0 rounded-control border border-line-strong bg-panel px-2 py-1 type-body">
            <option value="">Who to ask…</option>
            {teammates.map((m) => (
              <option key={m.id} value={m.id} disabled={!!m.away}>
                {m.name}: {m.away ?? m.facts}
              </option>
            ))}
          </select>
          <Button disabled={pending || !who || !picked.length} onClick={() => start(async () => setResult(await askCoverAction(leaveId, who, picked, commandId)))}>
            Ask to cover
          </Button>
        </span>
      ) : (
        <span className="type-caption text-fg-3">Nobody else is on {projectName} to ask.</span>
      )}
      <ActionNote result={result} />
    </fieldset>
  );
}

/** Ends the offer it was shown with, by id, so a late tap never ends a newer one (rule 6). */
export function NoCoverNeeded({ leaveId, offerId }: { leaveId: string; offerId: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [commandId] = useState(() => crypto.randomUUID());
  return (
    <span className="flex flex-col gap-1">
      <Button variant="link" className="self-start" disabled={pending || !!result?.ok} onClick={() => start(async () => setResult(await dismissCoverAction(leaveId, offerId, commandId)))}>
        No cover needed
      </Button>
      <ActionNote result={result} />
    </span>
  );
}

/** The teammate asked: Accept, or can't; with several things, can't do one of them while the rest wait (LV8). */
export function CoverAnswerButtons({ id, items }: { id: string; items: { key: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const send = (answer: CoverAnswer) =>
    start(async () => {
      const r = await answerCoverAction(id, answer, commandId);
      setResult(r);
      // One item declined leaves the rest to answer: the next tap is a new command
      if (r.ok && answer.act === "decline_item") setCommandId(crypto.randomUUID());
    });
  if (result?.ok && !(items.length > 1 && result.message?.startsWith("You said you can't"))) {
    return (
      <span role="status" className="type-caption text-ok">
        {result.message}
      </span>
    );
  }
  return (
    <span role="group" aria-label="Cover while they're away" className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Button disabled={pending} onClick={() => send({ act: "accept" })}>
          Accept
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => send({ act: "decline" })}>
          I can&rsquo;t
        </Button>
      </span>
      {items.length > 1 &&
        items.map((i) => (
          <span key={i.key} className="flex flex-wrap items-center gap-1.5 type-caption text-fg-2">
            {i.label}
            <Button variant="link" disabled={pending} onClick={() => send({ act: "decline_item", key: i.key })}>
              Can&rsquo;t do this one
            </Button>
          </span>
        ))}
      <ActionNote result={result} />
    </span>
  );
}
