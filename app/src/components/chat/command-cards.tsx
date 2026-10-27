"use client";
// Acting from an answer (conversational plan, phase B, M20). On an answer line: the buttons its screen
// offers (Approve, Decline, Resolve, Mark done, Unblock, Give a reason), each a command confirmed in the
// same tap; a decline asks why first, and a reason starts from DPM's draft, as the inbox does. Under a
// reply in words: the confirm card ("Approve risk ... ?" [Approve] [Cancel]). The server checks the right
// and the version when it runs, so a button can still be refused; a refusal for a change offers a fresh answer.
import { useState, useTransition } from "react";
import { actOnLine, atlasReason, cancelChatCommand, confirmChatCommand, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";
import { commandButton, type LineAction } from "@/domain/machines/chat-command";
import type { ChatCommandView, TapView } from "@/queries/chat";
import { useChatSend } from "./chat-session";

function AskAgain({ asked }: { asked: string | null }) {
  const send = useChatSend();
  if (!asked) return null;
  return (
    <Button variant="link" onClick={() => send(asked)}>
      Ask again
    </Button>
  );
}

const box = "min-w-0 flex-1 rounded-sm border border-line-strong bg-panel px-2 py-1 type-caption text-fg-1 placeholder:text-fg-3";

/** The buttons on one answer line, or what happened when one was pressed (AC4: once only). */
export function LineActions({ captureId, line, projectId, actions, tapped }: { captureId: string; line: number; projectId: string; actions: LineAction[]; tapped: TapView | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [mode, setMode] = useState<"buttons" | "decline" | "reason">("buttons");
  const [words, setWords] = useState("");
  const [draft, setDraft] = useState<{ text: string; entryIds: string[]; by: "rules" | "atlas" } | null>(null);
  if (tapped) {
    return (
      <span className="flex flex-col items-end gap-1">
        <span role="status" className={`type-caption ${tapped.state === "done" ? "text-ok" : "text-bad"}`}>
          {tapped.message}
        </span>
        <AskAgain asked={tapped.askAgain} />
      </span>
    );
  }
  const act = (a: LineAction, input?: Parameters<typeof actOnLine>[3]) => start(async () => setResult(await actOnLine(captureId, line, a.act, input)));
  if (result?.ok) {
    return (
      <span role="status" className="type-caption text-ok">
        {result.message}
      </span>
    );
  }
  const decline = actions.find((a) => a.act === "decline" && a.proposal === "entry");
  const reason = actions.find((a) => a.act === "give_reason");
  if (mode === "decline" && decline) {
    return (
      <form
        className="flex w-[300px] flex-col items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          act(decline, { reason: words });
        }}
      >
        <input value={words} onChange={(e) => setWords(e.target.value)} aria-label="Why you decline" placeholder="Why you decline" className={`${box} w-full`} />
        <span className="flex gap-1.5">
          <Button type="submit" disabled={pending || !words.trim()}>
            Decline
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setMode("buttons")}>
            Back
          </Button>
        </span>
        <ActionNote result={result} />
      </form>
    );
  }
  if (mode === "reason" && reason) {
    return (
      <form
        className="flex w-[340px] flex-col items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          act(reason, { reason: words, entryIds: draft?.entryIds ?? [], draftedByAtlas: draft?.by === "atlas", edited: words.trim() !== draft?.text.trim() });
        }}
      >
        <textarea value={words} rows={3} onChange={(e) => setWords(e.target.value)} aria-label="Reason" className={`${box} w-full resize-none`} />
        <span className="flex gap-1.5">
          <Button type="submit" disabled={pending || !words.trim()}>
            Save reason
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setMode("buttons")}>
            Back
          </Button>
        </span>
        <ActionNote result={result} />
      </form>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex gap-1.5">
        {actions.map((a, i) => (
          <Button
            key={a.act}
            variant={i === 0 ? "primary" : "secondary"}
            disabled={pending}
            onClick={() => {
              if (a === decline) return setMode("decline");
              if (a !== reason) return act(a);
              // A reason starts from DPM's draft, with the entries it links, as the inbox's editor does (M11)
              start(async () => {
                const d = await atlasReason(projectId);
                setDraft(d);
                setWords(d.text);
                setMode("reason");
              });
            }}
          >
            {a.act === "give_reason" ? "Give a reason" : commandButton({ act: a.act, proposal: a.proposal ?? null, outcome: a.outcome ?? null })}
          </Button>
        ))}
      </span>
      <ActionNote result={result} />
    </span>
  );
}

/** The confirm card for a reply in words: one decision, confirmed or cancelled by the person who said it (AC8, rule 10). */
export function CommandCard({ view }: { view: ChatCommandView }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [words, setWords] = useState(view.words ?? "");
  const open = view.state === "proposed" && !result?.ok;
  return (
    <div role="group" aria-label={view.question} className="flex flex-col gap-2 rounded-panel border border-line px-3 py-2.5">
      <span className="type-body-medium text-fg-1">{view.question}</span>
      {open && view.asksWords && (
        <textarea
          value={words}
          rows={view.act === "give_reason" ? 3 : 1}
          onChange={(e) => setWords(e.target.value)}
          aria-label={view.act === "give_reason" ? "Reason" : "Why you decline"}
          placeholder={view.act === "give_reason" ? "The reason" : "Why you decline"}
          className={`${box} w-full resize-none`}
        />
      )}
      {view.links.length > 0 && <span className="type-caption text-fg-2">Linked to {view.links.join(", ")}</span>}
      {open ? (
        <span className="flex gap-1.5">
          <Button disabled={pending || (view.asksWords && !words.trim())} onClick={() => start(async () => setResult(await confirmChatCommand(view.id, view.asksWords ? { reason: words } : undefined)))}>
            {view.button}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await cancelChatCommand(view.id)))}>
            Cancel
          </Button>
        </span>
      ) : (
        !result && view.outcome && <span className={`type-caption ${view.state === "done" ? "text-ok" : view.state === "refused" ? "text-bad" : "text-fg-3"}`}>{view.outcome}</span>
      )}
      <ActionNote result={result} />
      {(view.askAgain || (result && !result.ok)) && <AskAgain asked={view.askAgain} />}
    </div>
  );
}
