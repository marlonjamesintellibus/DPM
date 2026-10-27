"use client";
// The open conversation's screen (section 17): the thread, what is on its way, and the box. A message
// shows the moment it is sent, with "Thinking…" under it, before the server has it; the box sends one
// message at a time (MF2), and a refused one comes back to the box with the reason (MF1). Suggested
// follow-ups under a reply send through the same path (MF9).
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendUpdate } from "@/app/actions";
import { ASK_ATLAS_INPUT } from "@/components/shell/ask-atlas";
import { ActionNote } from "@/components/ui/controls";
import { ThinkingLine } from "./thinking";

type Pending = { id: string; text: string };
const SendContext = createContext<((text: string) => void) | null>(null);

/** Sends a message into the open conversation, as the box does. */
export function useChatSend(): (text: string) => void {
  const send = useContext(SendContext);
  if (!send) throw new Error("useChatSend outside a chat session");
  return send;
}

export function ChatSession({ conversationId, focus, children }: { conversationId: string | null; focus: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = pending.length > 0;
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [pending.length, children]);

  const send = (text: string) => {
    const words = text.trim();
    if (!words || busy) return; // MF2
    const id = crypto.randomUUID();
    setPending([{ id, text: words }]);
    setDraft("");
    setError(null);
    const form = new FormData();
    form.set("text", words);
    form.set("messageId", id);
    if (conversationId) form.set("conversationId", conversationId);
    void sendUpdate(null, form)
      .then((r) => {
        if (!r.ok) {
          // MF1: the words come back to the box, with the reason
          setDraft(words);
          setError(r.message ?? "That did not send. Try again.");
        } else if (!conversationId && r.conversationId) router.replace(`/?view=chat&c=${r.conversationId}`);
      })
      .catch(() => {
        setDraft(words);
        setError("That did not send. Check your connection and try again.");
      })
      .finally(() => setPending([]));
  };

  return (
    <SendContext.Provider value={send}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-20 pt-6 pb-4" aria-live="polite">
          {children}
          {pending.map((p) => (
            <div key={p.id} className="flex flex-col gap-[18px]">
              <div className="flex justify-end">
                <p className="max-w-[560px] rounded-[14px] bg-inverse px-3.5 py-2.5 type-body text-on-inverse">{p.text}</p>
              </div>
              <ThinkingLine label="Thinking" />
            </div>
          ))}
          <div ref={end} />
        </div>
        <form
          className="flex flex-col gap-1.5 px-20 pt-2 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="flex items-center gap-2.5 rounded-panel border border-line-strong bg-panel px-3.5 py-3">
            <textarea
              id={ASK_ATLAS_INPUT}
              rows={1}
              autoFocus={focus}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Message to Atlas"
              placeholder={conversationId ? "Reply to Atlas, or tell it what changed…" : "Tell Atlas what you did, or ask what needs you…"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              className="min-w-0 flex-1 resize-none bg-transparent type-body text-fg-1 outline-none placeholder:text-fg-3"
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="rounded-sm border border-line-strong bg-panel px-1.5 py-px type-micro text-fg-2 disabled:opacity-50">
              ↵
            </button>
          </div>
          {error && <ActionNote result={{ ok: false, message: error }} />}
        </form>
      </div>
    </SendContext.Provider>
  );
}
