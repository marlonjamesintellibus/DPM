"use client";
// The quiet tools under a reply (section 17): Copy (MF10), suggested follow-ups sent into the same
// conversation (MF9), Accept on a card for an item that needs the asker's OK (MF6, MF7), and the
// thumbs up or down on the answer (phase S).
import { useState, useTransition } from "react";
import { acceptFromChat, rateAnswer, setHelpImproveAtlasAction, type ActionResult } from "@/app/actions";
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
 * down asks "What was wrong?" (optional), and offers "Help improve Atlas" to someone who has it off.
 */
export function AnswerFeedback({ captureId, given, helpOn }: { captureId: string; given: { rating: "up" | "down"; wrong: string | null } | null; helpOn: boolean }) {
  const [rating, setRating] = useState(given?.rating ?? null);
  const [wrong, setWrong] = useState(given?.wrong ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const rate = (to: "up" | "down", words?: string) =>
    start(async () => {
      const before = rating;
      setRating(to);
      const r = await rateAnswer(captureId, to, words);
      if (!r.ok) setRating(before);
      setResult(r);
    });
  // Turned on from here, the thumbs down just given joins the candidates too: giving it again logs it
  const turnOn = () =>
    start(async () => {
      const r = await setHelpImproveAtlasAction(true);
      const again = r.ok ? await rateAnswer(captureId, "down", wrong) : r;
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
      {rating === "down" && (
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
          {!helpOn && (
            <span className="flex flex-wrap items-center gap-1.5 type-caption text-fg-3">
              Want the team building DPM to see this, so Atlas gets better?
              <Button variant="link" disabled={pending} onClick={turnOn}>
                Help improve Atlas
              </Button>
            </span>
          )}
        </span>
      )}
      <ActionNote result={result} />
    </>
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
