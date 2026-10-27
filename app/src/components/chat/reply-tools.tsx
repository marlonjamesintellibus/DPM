"use client";
// The quiet tools under a reply (section 17): Copy (MF10), suggested follow-ups sent into the same
// conversation (MF9), and Accept on a card for an item that needs the asker's OK (MF6, MF7).
import { useState, useTransition } from "react";
import { acceptFromChat, type ActionResult } from "@/app/actions";
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
