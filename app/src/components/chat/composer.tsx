"use client";
// Tell Atlas what you did, or ask it something. The message goes into the conversation open on screen,
// or starts a new one (section 16); it is stored as received, Atlas reads it after the reply, and the
// chat shows "Reading your update…" until the proposals or the answer are ready (5.1, section 15).
// Ask Atlas and ⌘K open the chat with this box ready to type.
import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { sendUpdate, type SendResult } from "@/app/actions";
import { ASK_ATLAS_INPUT } from "@/components/shell/ask-atlas";
import { ActionNote } from "@/components/ui/controls";

export function Composer({ focus = false, conversationId }: { focus?: boolean; conversationId: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<SendResult | null, FormData>(async (prev, form) => {
    const r = await sendUpdate(prev, form);
    if (r.ok) {
      formRef.current?.reset();
      // A new conversation is stored with its first message; the chat moves to it (CV1)
      if (!conversationId && r.conversationId) router.replace(`/?view=chat&c=${r.conversationId}`);
    }
    return r;
  }, null);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-1.5">
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}
      <div className="flex items-center gap-2.5 rounded-panel border border-line-strong bg-panel px-3.5 py-3">
        <textarea
          name="text"
          rows={1}
          id={ASK_ATLAS_INPUT}
          autoFocus={focus}
          aria-label="Message to Atlas"
          placeholder={conversationId ? "Reply to Atlas, or tell it what changed…" : "Tell Atlas what you did, or ask what needs you…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent type-body text-fg-1 outline-none placeholder:text-fg-3"
        />
        <button type="submit" disabled={pending} aria-label="Send" className="rounded-sm border border-line-strong bg-panel px-1.5 py-px type-micro text-fg-2 disabled:opacity-50">
          {pending ? "…" : "↵"}
        </button>
      </div>
      {state && !state.ok && <ActionNote result={state} />}
    </form>
  );
}
