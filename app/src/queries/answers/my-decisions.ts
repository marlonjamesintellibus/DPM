// What waits for the asker's decision (conversational plan, phase N), oldest first: proposals (a BRAID
// entry to approve, a blocker someone says is cleared, how a risk, assumption or dependency ended, a
// correction to how Atlas reads names), a member's request to change an entry's kind, a status they set
// that waits for a reason or to be kept, and Asks to them as an owner (M37). Read from their own inbox,
// so each approver sees a decision until one of them decides it (LD8, S11), and only on projects they
// still read (P10). Each line offers what its inbox item offers (phase B).
import { getInbox, type InboxCause } from "../inbox";
import { clockTime, shortDate, todayIn } from "../project";
import { OFFER, subjectOf } from "./needs-me";
import { capped, counted, type AnswerBuilder, type DraftCard } from "./shared";

/** The inbox causes that wait on the asker's decision, and how each is called on its line. */
const DECISIONS: Partial<Record<InboxCause, string>> = {
  approve: "Proposal",
  clear: "Proposal",
  confirm_outcome: "Proposal",
  vocab_change: "Proposal",
  kind_change: "Kind change",
  status_set_with_no_reason: "Status you set",
  keep_set_status: "Status you set",
  owner_ask: "Asks you",
};

export const myDecisions: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const waiting = (await getInbox(conn, viewerId, now)).items
    .filter((i) => DECISIONS[i.cause] && (!projectId || i.project?.id === projectId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const on = projectId && waiting[0]?.project ? ` on ${waiting[0].project.name}` : "";
  if (!waiting.length) return { text: "Nothing waits for your decision right now.", cards: [], more: null };
  const cards = waiting.map((i): DraftCard => {
    const subject = subjectOf(i.subject);
    return {
      title: i.title,
      detail: `${i.project ? `${i.project.name}: ` : ""}waiting since ${todayIn(i.createdAt) === todayIn(now) ? clockTime(i.createdAt) : shortDate(todayIn(i.createdAt))}`,
      tag: DECISIONS[i.cause]!,
      href: `/?view=inbox&item=${encodeURIComponent(i.id)}`,
      ...(subject ? { subject, offer: OFFER[i.cause] ?? [] } : {}),
    };
  });
  return { text: `${counted(waiting.length, "decision waits", "decisions wait")} on you${on}, oldest first.`, ...capped(cards, { label: "in your inbox", href: "/?view=inbox" }) };
};
