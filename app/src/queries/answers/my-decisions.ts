// What waits for the asker's decision (conversational plan, phase N), oldest first: proposals (a BRAID
// entry to approve, a blocker someone says is cleared, how a risk, assumption or dependency ended, a
// correction to how Atlas reads names, what Atlas drafted after one ended), a member's request to change
// an entry's kind, a status they set that waits for a reason or to be kept, whether a blocker is resolved
// now its work moves (E93), whether a dependency past its date was delivered (U2), leave they decide as
// its admin (D6; a lead shown only what it touches plans cover, which is no decision) and Asks to them
// as an owner (M37), and what a meeting note says of theirs (phase O, M34). Read from their own inbox, so each approver sees a decision until one of them
// decides it (LD8, S11), and only on projects they still read (P10). Each line offers what its inbox
// item offers (phase B).
import { getInbox, type InboxCause, type InboxEntry } from "../inbox";
import { clockTime, shortDate, todayIn } from "../project";
import { OFFER, subjectOf } from "./needs-me";
import { capped, counted, type AnswerBuilder, type DraftCard } from "./shared";

/** The inbox causes that wait on the asker's decision, and how each is called on its line. */
const DECISIONS: Partial<Record<InboxCause, string>> = {
  approve: "Proposal",
  clear: "Proposal",
  confirm_outcome: "Proposal",
  vocab_change: "Proposal",
  follow_up: "Atlas drafted",
  kind_change: "Kind change",
  status_set_with_no_reason: "Status you set",
  keep_set_status: "Status you set",
  confirm_clear: "Blocker resolved?",
  dependency_due: "Dependency due",
  leave_impact: "Leave",
  owner_ask: "Asks you",
  // Phase O, M34: whether what a meeting note says of theirs is right is theirs alone to say (rule 10)
  attributed: "Meeting note",
};

/** D6: leave waits on the admin who decides it; the leads it is shown to only plan cover. */
const decides = (i: InboxEntry) => !!DECISIONS[i.cause] && (i.cause !== "leave_impact" || i.action === "Decide");

export const myDecisions: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const waiting = (await getInbox(conn, viewerId, now)).items
    .filter((i) => decides(i) && (!projectId || i.project?.id === projectId))
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
