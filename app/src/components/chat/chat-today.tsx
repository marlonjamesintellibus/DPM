// Today as a chat (Figma L1 for the web layout, L18e and L18f for the capture), working as Claude or
// ChatGPT do (section 16): the viewer's conversations, newest first, with New, rename, archive and
// restore; the open one with every message in it, what Atlas made of each per project and the way into
// the review, DPM's answer when one asked something (section 15), the notices that belong to it (D15,
// CV14), and the box for the next message. Only the viewer's own conversations are read (M1).
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { startReview } from "@/app/actions";
import { getDb } from "@/db/client";
import type { Answer } from "@/domain/question";
import { suggestionsAfter } from "@/domain/topics";
import { getConversationList, getThread, type ChatCapture, type ConversationRow, type Thread } from "@/queries/chat";
import { clockTime, leadsAProject } from "@/queries/project";
import { ChatSession } from "./chat-session";
import { AcceptItem, AnswerFeedback, CopyReply, Suggestions, UndoSave } from "./reply-tools";
import { CommandCard, LineActions } from "./command-cards";
import { ClarifyButtons } from "./clarify";
import { StandupButtons } from "./standup";
import { DraftEditor } from "./draft";
import { ThinkingLine } from "./thinking";
import { ConversationMenu } from "./conversation-menu";
import { RefreshWhile } from "./refresh-while";

const READING = new Set(["received", "transcribing", "transcribe_wait", "reading", "retry_wait"]);
/** Section 17: "Still working on it…" after this long; a reply still being worded after WORDING_MS shows DPM's own words (MF4). */
const STILL_WORKING_MS = 8_000;
const WORDING_MS = 30_000;

/** Atlas is still writing this answer, and not for too long (MF4). */
function wording(answer: Answer | null, at: Date): boolean {
  return !!answer && answer.wording === "pending" && at.getTime() - new Date(answer.asOf).getTime() < WORDING_MS;
}

/** helpOn: the viewer's "Help improve Atlas" (phase S), read once by the page for the shell and the thumbs. */
export async function ChatToday({ viewerId, firstName, conversationId, ask = false, at, helpOn }: { viewerId: string; firstName: string; conversationId?: string; ask?: boolean; at: Date; helpOn: boolean }) {
  const db = await getDb();
  const list = await getConversationList(db, viewerId, at);
  // A new conversation is only a screen until its first message (CV1); otherwise the newest one opens
  const openId = conversationId === "new" ? null : (conversationId ?? list.active[0]?.id ?? null);
  const thread = openId ? await getThread(db, viewerId, openId, at) : null;
  if (thread && !thread.found) notFound();
  const open = thread?.found ? thread : null;
  // Phase G: and while Atlas writes a draft (its model timer ends that, rule 5)
  const reading = !!open?.turns.some((c) => READING.has(c.state) || wording(c.answer, at) || c.draft?.state === "requested");
  // W3-D12: the lead questions (phase N) are named only to a PM or Lead
  const lead = !open && (await leadsAProject(db, viewerId));
  return (
    <div className="flex min-h-0 flex-1">
      <RefreshWhile active={reading} />
      <nav aria-label="Conversations" className="flex w-[260px] shrink-0 flex-col gap-0.5 overflow-auto border-r border-line px-2.5 py-4">
        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="flex-1 type-label text-fg-2">Conversations</span>
          <Link href="/?view=chat&c=new&ask=1" className="flex items-center gap-1 rounded-control border border-line-strong bg-panel px-2 py-0.5 type-label text-fg-1 hover:bg-hover">
            <Icon name="plus-14" />
            New
          </Link>
        </div>
        {list.active.length === 0 && <span className="px-2.5 type-caption text-fg-3">Your conversations will show here.</span>}
        {list.active.map((c) => (
          <ConversationLink key={c.id} c={c} open={c.id === open?.conversation.id} />
        ))}
        {list.archived.length > 0 && (
          <details className="mt-3 flex flex-col">
            <summary className="cursor-pointer list-none px-2 py-1.5 type-caption text-fg-3 hover:text-fg-2">Archived ({list.archived.length})</summary>
            {list.archived.map((c) => (
              <ConversationLink key={c.id} c={c} open={c.id === open?.conversation.id} />
            ))}
          </details>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatSession key={open?.conversation.id ?? "new"} focus={ask} conversationId={open?.conversation.id ?? null}>
          {open ? (
            <>
              {open.conversation.state === "archived" && <p className="type-caption text-fg-3">This conversation is archived. Sending a message brings it back.</p>}
              <Messages thread={open} at={at} helpOn={helpOn} />
            </>
          ) : (
            <AtlasLine>
              <span>
                Morning, {firstName}. Tell me what you did, what is blocked and what is next, and I will put each part in the right project for you to check. You can also ask me what
                needs you, what you&rsquo;re working on, what&rsquo;s due, any updates, who mentioned you, what is blocked, how a project stands, what a teammate is working on, or what a
                project is and where to start on it.
                {lead && " As a lead, you can also ask who hasn\u2019t updated today, what needs your decision, what\u2019s at risk this week, how all your projects stand, or who can pick up a piece of work, and I can draft a client status or a weekly summary for your project."}{" "}
                Or I can ask you, in a short standup, or draft your standup for you to copy.
              </span>
              {/* Phase J: the standup's button sends what typing it would; phase G: so does the draft's */}
              <Suggestions asks={["Start my standup", "Draft my standup"]} />
            </AtlasLine>
          )}
        </ChatSession>
      </div>
    </div>
  );
}

function ConversationLink({ c, open }: { c: ConversationRow; open: boolean }) {
  return (
    <div className={`group flex items-start gap-1 rounded-control pr-1 ${open ? "bg-hover" : "hover:bg-hover"}`}>
      <Link href={`/?view=chat&c=${c.id}`} aria-current={open ? "true" : undefined} className="flex min-w-0 flex-1 flex-col gap-px px-2.5 py-2">
        <span className={`truncate type-body ${open ? "text-fg-1" : "text-fg-2"}`}>{c.title}</span>
        <span className="type-caption text-fg-3">
          {c.channel === "atlas" ? "Atlas app · " : ""}
          {c.when}
        </span>
      </Link>
      <div className={`pt-2 ${open ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
        <ConversationMenu id={c.id} title={c.title} archived={c.state === "archived"} open={open} />
      </div>
    </div>
  );
}

/** Every message and Atlas's reply to each, with the notices that belong here, in time order. */
function Messages({ thread, at, helpOn }: { thread: Thread; at: Date; helpOn: boolean }) {
  const last = thread.turns.at(-1)?.id;
  const items = [
    ...thread.turns.map((c) => ({ at: c.messageAt.getTime(), key: c.id, node: <Turn key={c.id} capture={c} at={at} last={c.id === last} helpOn={helpOn} /> })),
    ...thread.notices.map((n) => ({
      at: n.at.getTime(),
      key: n.id,
      node: (
        <AtlasLine key={n.id}>
          <span>
            {n.text} <span className="type-micro text-fg-3">· {n.time}</span>
          </span>
        </AtlasLine>
      ),
    })),
  ].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  return <>{items.map((i) => i.node)}</>;
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

/**
 * Sections 15 and 17: the reply to a question. Atlas's words (or DPM's own) over cards drawn from the
 * asker's data, then the time it was given, Copy, and on the latest reply one or two follow-ups. Phase B:
 * a line the asker can act on carries its screen's buttons; an update waiting for review opens it.
 */
function AnswerBlock({ capture, answer, last, helpOn }: { capture: ChatCapture; answer: Answer; last: boolean; helpOn: boolean }) {
  const copy = [answer.text, ...answer.cards.map((c) => `- ${c.title}${c.detail ? `: ${c.detail}` : ""}`), ...(answer.more ? [answer.more.label] : [])].join("\n");
  return (
    <AtlasLine>
      <span>{answer.text}</span>
      {answer.cards.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-panel border border-line">
          {answer.cards.map((c, i) => (
            // The whole card is the target and lights up as one, like a button; Accept and the line's actions sit above it
            <li
              key={`${c.href}|${c.title}|${c.accept?.itemId ?? ""}`}
              className="group relative flex items-center gap-3 border-b border-line px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hover has-[a:focus-visible]:bg-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent has-[a:focus-visible]:ring-inset"
            >
              <Link href={c.href} className="flex min-w-0 flex-1 flex-col gap-0.5 outline-none after:absolute after:inset-0">
                <span className="type-body-medium text-fg-1">{c.title}</span>
                {c.detail && <span className="type-caption text-fg-2">{c.detail}</span>}
                {c.tag && <span className={`type-micro ${c.accept ? "text-warn" : "text-fg-3"}`}>{c.tag}</span>}
              </Link>
              {c.accept ? (
                <span className="relative z-10 flex shrink-0 items-start gap-2">
                  <AcceptItem captureId={c.accept.captureId} itemId={c.accept.itemId} />
                </span>
              ) : c.actions?.length && c.subject ? (
                <span className="relative z-10 flex shrink-0 items-start gap-2">
                  <LineActions captureId={capture.id} line={i + 1} projectId={c.subject.projectId} actions={c.actions} tapped={capture.taps.findLast((t) => t.line === i + 1) ?? null} />
                </span>
              ) : c.review ? (
                <form action={startReview.bind(null, c.review.captureId)} className="relative z-10 shrink-0">
                  <button type="submit" className="rounded-control border border-line-strong bg-panel px-2.5 py-1 type-label text-fg-1 hover:bg-hover">
                    Open review
                  </button>
                </form>
              ) : (
                <span className="shrink-0 transition-transform group-hover:translate-x-0.5">
                  <Icon name="chevron-right-12" tone="text-fg-3" />
                </span>
              )}
            </li>
          ))}
          {answer.more && (
            <li className="px-3 py-2">
              <Link href={answer.more.href} className="type-caption text-accent hover:underline">
                {answer.more.label}
              </Link>
            </li>
          )}
        </ul>
      )}
      <span className="flex flex-wrap items-center gap-2 type-micro text-fg-3">
        <span>As of {clockTime(new Date(answer.asOf))}</span>
        <CopyReply text={copy} />
        <AnswerFeedback captureId={capture.id} given={capture.feedback} helpOn={helpOn} />
      </span>
      {last && <Suggestions asks={suggestionsAfter(answer.topic)} />}
    </AtlasLine>
  );
}

function Turn({ capture, at, last, helpOn }: { capture: ChatCapture; at: Date; last: boolean; helpOn: boolean }) {
  const waiting = capture.state === "proposed" || capture.state === "reviewing";
  const reading = READING.has(capture.state);
  const rows = [
    ...capture.rows.map((r) => `${r.name} · ${r.changes} ${r.changes === 1 ? "update" : "updates"}${r.needsOk ? ` · ${r.needsOk} need${r.needsOk === 1 ? "s" : ""} your OK` : ""}`),
    ...(capture.personal ? [`You · ${capture.personal} personal ${capture.personal === 1 ? "item" : "items"}, only you see ${capture.personal === 1 ? "it" : "them"}`] : []),
    ...(capture.notFiled ? [`${capture.notFiled} not filed in any project`] : []),
  ];
  const line = waiting && capture.needsOk ? capture.line.replace(/;/, ", and") : capture.line;
  const thinking = reading || wording(capture.answer, at);
  const since = at.getTime() - capture.receivedAt.getTime();
  // Phase J: a standup's answers were put together by DPM; they are not a message the person typed
  const yours = capture.fromStandup ? null : <YourMessage capture={capture} />;
  if (thinking) {
    // Section 17: never "Reading your update": a message may be a question
    return (
      <>
        {yours}
        <ThinkingLine label={since > STILL_WORKING_MS ? "Still working on it" : "Thinking"} />
      </>
    );
  }
  if (capture.state === "answered") {
    return (
      <>
        {yours}
        {capture.answer && <AnswerBlock capture={capture} answer={capture.answer} last={last} helpOn={helpOn} />}
        {capture.answered && <AtlasLine>{capture.answered}</AtlasLine>}
        <CommandsBlock capture={capture} />
        <ClarifyBlock capture={capture} />
        <StandupBlock capture={capture} />
        <DraftBlock capture={capture} />
      </>
    );
  }
  return (
    <>
      {yours}
      <AtlasLine>
        {capture.fromStandup && <span className="type-caption text-fg-3">Your standup answers, as one update</span>}
        <span>{line}</span>
        {rows.length > 0 && (
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
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/review/${capture.id}`} className="type-caption text-accent hover:underline">
              {capture.undo?.state === "undone" ? "See what was taken back" : "See what was saved"}
            </Link>
            {/* Phase L, M30: Undo while it may still work; once undone, when */}
            {capture.undo?.may && <UndoSave captureId={capture.id} />}
            {capture.undo?.state === "undone" && capture.undo.at && <span className="type-caption text-fg-3">You undid this at {clockTime(capture.undo.at)}.</span>}
            {capture.undo?.state === "refused" && capture.undo.note && <span className="type-caption text-fg-3">{capture.undo.note}</span>}
          </div>
        )}
      </AtlasLine>
      {capture.answer && <AnswerBlock capture={capture} answer={capture.answer} last={last} helpOn={helpOn} />}
      <CommandsBlock capture={capture} />
      <ClarifyBlock capture={capture} />
      <StandupBlock capture={capture} />
    </>
  );
}

/**
 * Phase G, M25: the draft this message asked for. While Atlas writes it, "Drafting"; once ready, the words to
 * edit with Copy, Refresh and Discard, "as of" when its facts were read (DR5), and what a Refresh kept aside;
 * once it ended, how. A draft about a project its owner can no longer read shows nothing of it (P10).
 */
function DraftBlock({ capture }: { capture: ChatCapture }) {
  const d = capture.draft;
  if (!d) return null;
  if (d.state === "requested") return <ThinkingLine label={`Drafting your ${d.label}`} />;
  const title = `Draft ${d.label}${d.project ? ` for ${d.project}` : ""}`;
  return (
    <AtlasLine>
      {d.closed ? (
        <span className="type-caption text-fg-3">
          {d.kind === "standup" && !d.project ? "You can no longer read a project this standup is from, so it is closed." : "You can no longer read this project, so its draft is closed."}
        </span>
      ) : (
        <div role="group" aria-label={title} className="flex flex-col gap-2 rounded-panel border border-line px-3 py-2.5">
          <span className="flex flex-wrap items-center gap-2 type-caption text-fg-3">
            <span className="type-label text-fg-1">{title}</span>
            <span>· as of {d.asOf}</span>
            {/* DR2, DR6: DPM's own list of the facts, when Atlas could not write it */}
            {d.by === "plain" && <span>· the facts as a plain list</span>}
          </span>
          {d.state === "ready" && d.text !== null ? (
            <DraftEditor key={d.text} id={d.id} text={d.text} label={d.label} />
          ) : (
            <>
              {d.text && <p className="whitespace-pre-wrap type-body text-fg-2">{d.text}</p>}
              {d.ended && <span className="type-caption text-fg-3">{d.ended}</span>}
            </>
          )}
          {d.aside && (
            <details className="type-caption text-fg-3">
              <summary className="cursor-pointer">Your earlier edits, kept aside</summary>
              <p className="mt-1 whitespace-pre-wrap type-body text-fg-2">{d.aside}</p>
            </details>
          )}
        </div>
      )}
    </AtlasLine>
  );
}

/**
 * Phase J, M28: the standup questions asked after this message, each with the tap that answered it (typed
 * words show as the next message), the one waiting with its buttons, and how it ended.
 */
function StandupBlock({ capture }: { capture: ChatCapture }) {
  const s = capture.standup;
  if (!s) return null;
  return (
    <>
      {s.steps.map((step) => (
        <AtlasLine key={step.n}>
          <span>{step.text}</span>
          {step.answer && <span className="self-start rounded-full bg-panel-2 px-2.5 py-0.5 type-caption text-fg-2">{step.answer}</span>}
        </AtlasLine>
      ))}
      {s.current && (
        <AtlasLine>
          {/* P10: a question about a project they can no longer read is not named */}
          <span>{s.current.text ?? "I can't ask about that one any more."}</span>
          <StandupButtons id={s.id} n={s.current.n} taps={s.current.taps} />
        </AtlasLine>
      )}
      {s.ended && <AtlasLine>{s.ended}</AtlasLine>}
    </>
  );
}

/** Phase D, M21: Atlas asks which one it means, with the options as buttons; once answered, what came of it. */
function ClarifyBlock({ capture }: { capture: ChatCapture }) {
  const c = capture.clarification;
  if (!c) return null;
  return (
    <AtlasLine>
      <span>{c.question}</span>
      {c.state === "asked" ? <ClarifyButtons id={c.id} options={c.options} /> : c.outcome && <span className="type-caption text-fg-3">{c.outcome}</span>}
    </AtlasLine>
  );
}

/** Phase B: what a reply in words decided: a confirm card per line (AC8), or why it made none (AC6, AC7, AC9). */
function CommandsBlock({ capture }: { capture: ChatCapture }) {
  if (!capture.commands.length && !capture.commandNote) return null;
  return (
    <AtlasLine>
      {capture.commandNote && <span>{capture.commandNote}</span>}
      {capture.commands.map((c) => (
        <CommandCard key={c.id} view={c} />
      ))}
    </AtlasLine>
  );
}
