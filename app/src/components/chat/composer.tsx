"use client";
// Tell Atlas what you did, or ask it something. The message is stored as received, Atlas reads it
// after the reply, and the chat shows "Reading your update…" until the proposals or the answer are
// ready (5.1, section 15). Ask Atlas and ⌘K open the chat with this box ready to type.
import { useActionState, useRef } from "react";
import { sendUpdate, type ActionResult } from "@/app/actions";
import { ASK_ATLAS_INPUT } from "@/components/shell/ask-atlas";
import { ActionNote } from "@/components/ui/controls";

export function Composer({ focus = false }: { focus?: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await sendUpdate(prev, form);
    if (r.ok) formRef.current?.reset();
    return r;
  }, null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 rounded-panel border border-line-strong bg-panel px-3.5 py-3">
        <textarea
          name="text"
          rows={1}
          id={ASK_ATLAS_INPUT}
          autoFocus={focus}
          aria-label="Message to Atlas"
          placeholder="Tell Atlas what you did, or ask what needs you…"
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
