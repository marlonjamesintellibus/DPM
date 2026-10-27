// Today as a chat (Figma L1 for the web layout, L18e and L18f for the capture): the viewer's
// updates as conversations, the open one with what Atlas made of it per project and the way into
// the review, DPM's answer when it asked something (section 15), what Atlas told them since (D15),
// and the box for the next message. Only the viewer's own captures are read (M1).
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { startReview } from "@/app/actions";
import { getDb } from "@/db/client";
import type { Answer } from "@/domain/question";
import { getChatSummary, getConversations, type ChatCapture } from "@/queries/chat";
import { clockTime } from "@/queries/project";
import { Composer } from "./composer";
import { RefreshWhile } from "./refresh-while";

const READING = new Set(["received", "transcribing", "transcribe_wait", "reading", "retry_wait"]);

export async function ChatToday({ viewerId, firstName, captureId, ask = false }: { viewerId: string; firstName: string; captureId?: string; ask?: boolean }) {
  const db = await getDb();
  const [summary, conversations] = await Promise.all([getChatSummary(db, viewerId, captureId), getConversations(db, viewerId)]);
  const open = summary.latest;
  const reading = conversations.some((c) => READING.has(c.state));
  return (
    <div className="flex min-h-0 flex-1">
      <RefreshWhile active={reading} />
      <nav aria-label="Conversations" className="flex w-[250px] shrink-0 flex-col gap-0.5 border-r border-line px-2.5 py-4">
        <span className="flex items-center px-2 pb-2 type-label text-fg-2">Conversations</span>
        {conversations.length === 0 && <span className="px-2.5 type-caption text-fg-3">Your updates will show here.</span>}
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/?view=chat&capture=${c.id}`}
            aria-current={c.id === open?.id ? "true" : undefined}
            className={`flex flex-col gap-px rounded-control px-2.5 py-2 ${c.id === open?.id ? "bg-hover" : "hover:bg-hover"}`}
          >
            <span className={`truncate type-body ${c.id === open?.id ? "text-fg-1" : "text-fg-2"}`}>{c.title}</span>
            <span className="type-caption text-fg-3">{c.time}</span>
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-20 pt-6 pb-4">
          {!open && (
            <AtlasLine>
              Morning, {firstName}. Tell me what you did, what is blocked and what is next, and I will put each part in the right project for you to check. You can also ask me what needs
              you, what is blocked, or how a project stands.
            </AtlasLine>
          )}
          {open && <Thread capture={open} />}
          {[...summary.notices].reverse().map((n) => (
            <AtlasLine key={n.id}>
              <span>
                {n.text} <span className="type-micro text-fg-3">· {n.time}</span>
              </span>
            </AtlasLine>
          ))}
        </div>
        <div className="flex flex-col gap-2 px-20 pt-2 pb-5">
          <Composer focus={ask} />
        </div>
      </div>
    </div>
  );
}

function AtlasLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="pt-0.5">
        <Icon name="sparkles" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 type-body text-fg-1">{children}</div>
    </div>
  );
}

function YourMessage({ capture }: { capture: ChatCapture }) {
  if (capture.kind === "voice") {
    const seconds = capture.durationSeconds ?? 0;
    const quote = capture.text.length > 110 ? `${capture.text.slice(0, 50)}… ${capture.text.slice(-55)}` : capture.text;
    return (
      <div className="flex justify-end">
        <div className="flex w-[280px] flex-col gap-1.5 rounded-2xl bg-inverse px-3.5 py-2.5">
          <span className="flex items-center gap-2">
            <Icon name="mic-inverse-14" />
            <span className="h-1 w-[150px] rounded-[2px] bg-on-inverse" aria-hidden />
            <span className="type-caption text-on-inverse">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
          </span>
          {capture.text && <span className="type-caption text-on-inverse">&ldquo;{quote}&rdquo;</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <p className="max-w-[560px] rounded-[14px] bg-inverse px-3.5 py-2.5 type-body text-on-inverse">{capture.text}</p>
    </div>
  );
}

/** Section 15: DPM's answer from the asker's own data, with the time it was given (QA10). */
function AnswerLine({ answer }: { answer: Answer }) {
  return (
    <AtlasLine>
      <span>
        {answer.text} <span className="type-micro text-fg-3">· as of {clockTime(new Date(answer.asOf))}</span>
      </span>
      {answer.lines.length > 0 && (
        <ul className="overflow-hidden rounded-panel border border-line">
          {answer.lines.map((l) => (
            <li key={`${l.href}|${l.label}`} className="border-b border-line last:border-b-0">
              <Link href={l.href} className="flex items-center gap-2 px-3 py-2.5 hover:bg-hover">
                <span className="min-w-0 flex-1 type-body text-fg-2">{l.label}</span>
                <Icon name="chevron-right-12" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AtlasLine>
  );
}

function Thread({ capture }: { capture: ChatCapture }) {
  const waiting = capture.state === "proposed" || capture.state === "reviewing";
  const reading = READING.has(capture.state);
  const rows = [
    ...capture.rows.map((r) => `${r.name} · ${r.changes} ${r.changes === 1 ? "update" : "updates"}${r.needsOk ? ` · ${r.needsOk} need${r.needsOk === 1 ? "s" : ""} your OK` : ""}`),
    ...(capture.personal ? [`You · ${capture.personal} personal ${capture.personal === 1 ? "item" : "items"}, only you see ${capture.personal === 1 ? "it" : "them"}`] : []),
    ...(capture.notFiled ? [`${capture.notFiled} not filed in any project`] : []),
  ];
  const line = waiting && capture.needsOk ? capture.line.replace(/;/, ", and") : capture.line;
  if (capture.state === "answered" && capture.answer) {
    return (
      <>
        <YourMessage capture={capture} />
        <AnswerLine answer={capture.answer} />
      </>
    );
  }
  return (
    <>
      <YourMessage capture={capture} />
      <AtlasLine>
        <span>{reading ? "Reading your update…" : line}</span>
        {rows.length > 0 && !reading && (
          <ul className="overflow-hidden rounded-panel border border-line">
            {rows.map((r) => (
              <li key={r} className="flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0">
                <Icon name="check-ok-14" />
                <span className="type-body text-fg-2">{r}</span>
              </li>
            ))}
            {waiting && capture.needsOk > 0 && (
              <li className="flex items-center gap-2 bg-warn-soft px-3 py-2.5">
                <Icon name="alert-warn-14" />
                <span className="type-body text-fg-1">{capture.needsOk} {capture.needsOk === 1 ? "needs" : "need"} your OK · open the review to decide</span>
              </li>
            )}
          </ul>
        )}
        {waiting && (
          <div className="flex flex-col gap-2">
            <form action={startReview.bind(null, capture.id)} className="flex gap-2">
              <button type="submit" className="rounded-control bg-inverse px-2.5 py-1 type-label text-on-inverse">
                Review{capture.needsOk ? ` ${capture.needsOk}` : ""}
              </button>
              <Link href="/?view=chat" className="rounded-control border border-line-strong bg-panel px-2.5 py-1 type-label text-fg-1 hover:bg-hover">
                Later
              </Link>
            </form>
            <p className="type-caption text-fg-3">Each project sees only its own lines. Risks and decisions wait for a PM or Lead after you save.</p>
          </div>
        )}
        {capture.state === "saved" && (
          <Link href={`/review/${capture.id}`} className="type-caption text-accent hover:underline">
            See what was saved
          </Link>
        )}
      </AtlasLine>
      {capture.answer && !reading && <AnswerLine answer={capture.answer} />}
    </>
  );
}
