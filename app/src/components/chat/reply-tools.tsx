"use client";
// The quiet tools under a reply (section 17): Copy (MF10), suggested follow-ups sent into the same
// conversation (MF9), Accept on a card for an item that needs the asker's OK (MF6, MF7), and the
// thumbs up or down on the answer (phase S).
import { useState, useTransition } from "react";
import { acceptFromChat, rateAnswer, setHelpImproveAtlasAction, undoUpdate, type ActionResult } from "@/app/actions";
import { Icon } from "@/components/shell/icon";
import { ActionNote, Button } from "@/components/ui/controls";
import { useChatSend } from "./chat-session";

export function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
      className="rounded-sm px-1 type-micro text-fg-3 hover:bg-hover hover:text-fg-2"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Suggestions({ asks }: { asks: string[] }) {
  const send = useChatSend();
  return (
    <div className="flex flex-wrap gap-1.5">
      {asks.map((a) => (
        <button key={a} type="button" onClick={() => send(a)} className="rounded-full border border-line-strong px-2.5 py-1 type-caption text-fg-2 hover:bg-hover hover:text-fg-1">
          {a}
        </button>
      ))}
    </div>
  );
}

/**
 * Phase S: a thumbs up or down on the answer, next to Copy, which the asker can change (LF6). A thumbs
 * down asks "What was wrong?" (optional) while "Help improve Atlas" is on. With it off only the thumbs is
 * kept (LF1), so instead of the box it offers the setting.
 */
export function AnswerFeedback({ captureId, given, helpOn }: { captureId: string; given: { rating: "up" | "down"; wrong: string | null } | null; helpOn: boolean }) {
  const [rating, setRating] = useState(given?.rating ?? null);
  const [wrong, setWrong] = useState(given?.wrong ?? "");
  const [turnedOn, setTurnedOn] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const on = helpOn || turnedOn;
  const rate = (to: "up" | "down", words?: string) =>
    start(async () => {
      const before = rating;
      setRating(to);
      const r = await rateAnswer(captureId, to, words);
      if (!r.ok) setRating(before);
      setResult(r);
    });
  // Turned on from here, the thumbs down just given is given again so it joins the candidates, unless the
  // team building DPM already decided on it. Only the thumbs: what was wrong goes when they press Send
  const turnOn = () =>
    start(async () => {
      const r = await setHelpImproveAtlasAction(true);
      if (r.ok) setTurnedOn(true);
      const again = r.ok ? await rateAnswer(captureId, "down") : r;
      setResult(again.ok ? r : again);
    });
  const thumb = (to: "up" | "down", label: string) => (
    <button type="button" aria-label={label} aria-pressed={rating === to} disabled={pending} onClick={() => rating !== to && rate(to)} className="flex rounded-sm p-0.5 hover:bg-hover disabled:opacity-50">
      <Icon name={to === "up" ? "thumb-up" : "thumb-down"} tone={rating === to ? "text-fg-1" : undefined} />
    </button>
  );
  return (
    <>
      {thumb("up", "Good answer")}
      {thumb("down", "Not right")}
      {rating === "down" && !on && (
        <span className="flex w-full basis-full flex-wrap items-center gap-1.5 pt-1 type-caption text-fg-3">
          Only your thumbs down is kept. To tell the team building DPM what was wrong, turn on
          <Button variant="link" disabled={pending} onClick={turnOn}>
            Help improve Atlas
          </Button>
        </span>
      )}
      {rating === "down" && on && (
        <span className="flex w-full basis-full flex-col gap-1.5 pt-1">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              rate("down", wrong);
            }}
          >
            <input
              value={wrong}
              onChange={(e) => setWrong(e.target.value)}
              maxLength={500}
              aria-label="What was wrong?"
              placeholder="What was wrong? (optional)"
              className="min-w-0 flex-1 rounded-sm border border-line-strong bg-panel px-2 py-1 type-caption text-fg-1 placeholder:text-fg-3"
            />
            <Button type="submit" variant="secondary" disabled={pending || !wrong.trim() || wrong.trim() === (given?.wrong ?? "")}>
              Send
            </Button>
          </form>
        </span>
      )}
      <ActionNote result={result} />
    </>
  );
}

/**
 * Phase L, M30: Undo on a saved message, while undoMinutes have not passed. The button carries its own
 * command id, so a second press undoes nothing more (UN5); the command checks everything again as it runs.
 */
export function UndoSave({ captureId }: { captureId: string }) {
  const [commandId] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  if (result?.ok) return <span className="type-caption text-fg-2">{result.message}</span>;
  return (
    <span className="flex flex-col items-start gap-1">
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await undoUpdate(captureId, commandId)))}>
        Undo
      </Button>
      <ActionNote result={result} />
    </span>
  );
}

export function AcceptItem({ captureId, itemId }: { captureId: string; itemId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  if (result?.ok) return <span className="type-caption text-ok">Accepted</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <Button disabled={pending} onClick={() => start(async () => setResult(await acceptFromChat(captureId, itemId)))}>
        Accept
      </Button>
      <ActionNote result={result} />
    </span>
  );
}
