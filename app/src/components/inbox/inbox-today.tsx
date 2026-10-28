// Today as an inbox (A8; Figma L6b, L6c): the viewer's live items in one card, worst first, and
// the chosen one open on the right with what is needed to clear it. Everything is read as the
// viewer (P10); a BRAID entry shows only the quotes routed to its project (rule 9).
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Icon, type IconName } from "@/components/shell/icon";
import { Card } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/controls";
import { draftReason } from "@/commands/status";
import { getDb } from "@/db/client";
import { loadBraidLog } from "@/db/records";
import * as t from "@/db/schema";
import { withArticle } from "@/domain/shared";
import { getInbox, type InboxEntry } from "@/queries/inbox";
import { getLeaveImpact } from "@/queries/leave";
import { describeOwnerAsk } from "@/queries/owner-ask";
import { signalsFor } from "@/queries/signals";
import { clockTime, firstName, getProject, KIND_LABEL, projectReader, todayIn, type ProjectView } from "@/queries/project";
import { asksDrop } from "@/domain/machines/commitment";
import { CommitmentButtons } from "@/components/chat/commitment";
import { CoverAnswerButtons } from "@/components/chat/cover";
import { describeCoverAsk } from "@/queries/cover";
import { OUTCOME_ACT } from "@/queries/review";
import { OUTCOMES, type ResolveOutcome } from "@/domain/machines/braid-entry";
import { KindRequestControls } from "@/components/project/kind-request-controls";
import { AcknowledgeControl, ClearControls, DecideControls, DependencyDueControls, FollowUpControls, OutcomeControls, OwnerAskControls, LeaveControls, LinkChangeForm, ReasonEditor, SignalControls, StillGoingControl, VocabularyControls } from "./inbox-actions";

const CAUSE_LABEL: Record<InboxEntry["cause"], string> = {
  status_set_with_no_reason: "Delivery check",
  keep_set_status: "Delivery check",
  approve: "BRAID approval",
  no_decider: "BRAID approval",
  more_info: "BRAID question",
  blocker_new: "New blocker",
  clear: "Blocker cleared?",
  confirm_clear: "Blocker cleared?",
  follow_up: "Drafted by Atlas",
  review_waiting: "Your update",
  leave_impact: "Leave",
  done_no_change: "Delivery check",
  kind_change: "Kind change",
  blocked_without_blocker: "Delivery check",
  dependency_due: "Dependency due",
  confirm_outcome: "Ended?",
  owner_ask: "Asked of you",
  vocab_change: "Correction",
  signals: "Atlas noticed",
  commitment_check: "Your promise",
  commitment_stands: "Your promise",
  cover_ask: "Cover",
};

/** Section 20, U3: the outcomes a kind can end in, the one first said first, as the PM's buttons. */
function outcomeChoices(kind: keyof typeof OUTCOMES, said: readonly ResolveOutcome[]) {
  const all = OUTCOMES[kind] ?? [];
  return [...all].sort((a, b) => Number(!said.includes(a)) - Number(!said.includes(b))).map((outcome) => ({ outcome, label: OUTCOME_ACT[outcome] }));
}

// The small mark before an item's source line: a rule's check, someone's words, work, people
function sourceIcon(item: InboxEntry): IconName {
  if (item.cause === "signals") return "sparkles-12";
  if (item.cause === "leave_impact" || item.cause === "cover_ask") return "users";
  if (item.cause === "done_no_change") return "git-commit";
  if (item.cause === "blocker_new" || item.cause === "confirm_clear" || item.cause === "blocked_without_blocker") return "alert";
  if (item.source === "Delivery check") return "check";
  return "message";
}

export async function InboxToday({ viewerId, selectedId, at }: { viewerId: string; selectedId: string | undefined; at: Date }) {
  const db = await getDb();
  const inbox = await getInbox(db, viewerId, at);
  const selected = selectedId === "none" ? undefined : (inbox.items.find((i) => i.id === selectedId) ?? inbox.items[0]);
  const firstNow = inbox.items.find((i) => i.group === "do_now");
  const also = firstNow && firstNow.id !== selected?.id ? firstNow : undefined;
  const n = inbox.items.length;
  const position = (item: InboxEntry) => inbox.items.indexOf(item) + 1;
  return (
    <div className="flex items-start gap-4">
      <Card
        label="Inbox"
        emphasis
        bodyClassName="gap-1.5"
        className="w-[520px] shrink-0 self-stretch"
        title={
          <span className="flex items-end gap-2">
            <span>Your next things</span>
            <span className="type-caption font-normal text-fg-3">{n ? `${n}, in order` : "none"}</span>
          </span>
        }
      >
        <p className="type-caption text-fg-3">{n ? "Pick one and it opens on the right. Nothing here is pushed to you." : "Nothing needs you right now. New items come here when a rule or someone's update needs you."}</p>
        {inbox.groups.map((g) => (
          <div key={g.group} className="flex flex-col gap-1.5">
            <p className="type-micro text-fg-3">{g.label}</p>
            {g.items.map((item) => (
              <InboxRow key={item.id} item={item} n={position(item)} selected={item.id === selected?.id} primary={g.group === "do_now"} />
            ))}
          </div>
        ))}
      </Card>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {selected && <Detail item={selected} label={`${CAUSE_LABEL[selected.cause]} · item ${position(selected)} of ${n}`} viewerId={viewerId} at={at} />}
        {also && <Detail item={also} label={`${CAUSE_LABEL[also.cause]} · item ${position(also)} of ${n}`} viewerId={viewerId} at={at} />}
        <YourProjects viewerId={viewerId} at={at} />
      </div>
    </div>
  );
}

function InboxRow({ item, n, selected, primary }: { item: InboxEntry; n: number; selected: boolean; primary: boolean }) {
  const href = `/?view=inbox&item=${encodeURIComponent(item.id)}`;
  return (
    <div className={`relative flex items-start gap-2.5 rounded-md px-3 py-[11px] ${selected ? "bg-accent-soft" : "hover:bg-hover"}`}>
      <span className="type-label text-fg-3">{n}</span>
      <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} className="flex min-w-0 flex-1 flex-col gap-[3px] after:absolute after:inset-0">
        <span className="type-body-medium text-fg-1">{item.title}</span>
        <span className="type-caption text-fg-2">Why here: {item.why}</span>
        <span className="flex items-center gap-1.5">
          <Icon name={sourceIcon(item)} />
          <span className="type-micro text-fg-3">{item.sourceLine}</span>
        </span>
      </Link>
      <Link
        href={href}
        scroll={false}
        className={`relative z-10 shrink-0 rounded-control px-2.5 py-1 type-label whitespace-nowrap ${primary ? "bg-inverse text-on-inverse" : "border border-line-strong bg-panel text-fg-1 hover:bg-hover"}`}
      >
        {item.action}
      </Link>
    </div>
  );
}

/** The card that holds an open item (L6b "Card · BRAID approval"): header with close, body p16 gap14. */
function DetailCard({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex-1 type-micro text-fg-3 uppercase">{label}</h2>
        <Link href="/?view=inbox&item=none" aria-label="Close" scroll={false} className="rounded-sm hover:bg-hover">
          <Icon name="x-14" />
        </Link>
      </div>
      <div className="flex flex-col gap-3.5 p-4">
        <h3 className="type-heading text-fg-1">{title}</h3>
        {children}
      </div>
    </section>
  );
}

/** Two grey boxes side by side (L6b "Source and similar", "Set vs calculated"). */
function Pair({ children }: { children: React.ReactNode }) {
  return <div className="flex items-stretch gap-3">{children}</div>;
}

function Box({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md bg-panel-2 p-3">
      <span className="type-caption text-fg-3">{head}</span>
      {children}
    </div>
  );
}

const Explain = ({ children }: { children: React.ReactNode }) => <p className="type-body text-fg-2">{children}</p>;

async function YourProjects({ viewerId, at }: { viewerId: string; at: Date }) {
  const db = await getDb();
  const reader = await projectReader(db, viewerId);
  const mine = reader.world.memberships.filter((m) => m.personId === viewerId && m.state === "member" && reader.mayRead(m.projectId));
  const views = (await Promise.all(mine.map((m) => getProject(db, viewerId, m.projectId, at)))).filter((v): v is ProjectView => v.found);
  return (
    <section className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-2.5 type-micro text-fg-3 uppercase">Your projects · {views.length}</h2>
      {views.map((v, i) => {
        const pending = v.braid.waitingForApproval;
        const line = [v.project.customer ?? "Internal", pending ? `${pending} waiting for approval` : null, v.setStatus && v.displayed.from === "calculated" ? `set ${v.setStatus.label}, no reason yet` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <Link key={v.project.id} href={`/projects/${v.project.id}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-hover ${i ? "border-t border-line" : ""}`}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="type-body-medium text-fg-1">{v.project.name}</span>
              <span className="type-caption text-fg-3">{line}</span>
            </span>
            <StatusMark status={v.displayed.status} label={v.displayed.label} />
            <Icon name="chevron-right-12" />
          </Link>
        );
      })}
    </section>
  );
}

// ---- The open item ----

async function Detail({ item, label, viewerId, at }: { item: InboxEntry; label: string; viewerId: string; at: Date }) {
  switch (item.subject.type) {
    case "project":
      return <StatusDetail item={item} label={label} projectId={item.subject.id} viewerId={viewerId} at={at} />;
    case "braid_entry":
      return <EntryDetail item={item} label={label} entryId={item.subject.id} projectId={item.subject.projectId} viewerId={viewerId} at={at} />;
    case "leave":
      return <LeaveDetail item={item} label={label} leaveId={item.subject.id} projectId={item.subject.projectId} viewerId={viewerId} />;
    case "owner_ask":
      return <OwnerAskDetail item={item} label={label} askId={item.subject.id} />;
    case "signals":
      return <SignalsDetail item={item} label={label} projectId={item.subject.projectId} day={item.subject.day} viewerId={viewerId} at={at} />;
    case "kind_request":
      return <KindRequestDetail item={item} label={label} entryId={item.subject.entryId} projectId={item.subject.projectId} viewerId={viewerId} at={at} />;
    case "vocabulary_change":
      // Phase L, M31: what it changes, and that it changes how Atlas files everyone's updates; nothing applies until approved
      return (
        <DetailCard label={label} title={item.title}>
          <Explain>Why it is here: {item.why}. Approving it changes how Atlas reads new updates from now on; nothing already filed moves.</Explain>
          <VocabularyControls changeId={item.subject.id} />
        </DetailCard>
      );
    case "work_item":
      if (item.cause === "blocked_without_blocker") {
        return (
          <DetailCard label={label} title={item.title}>
            <Explain>Why it is here: {item.why}. Tell Atlas when it moves, or link the blocker that holds it now.</Explain>
            <Link href={`/projects/${item.subject.projectId}?view=table`} className="self-start rounded-control border border-line-strong bg-panel px-2.5 py-1 type-label text-fg-1 hover:bg-hover">
              Open the BRAID log
            </Link>
          </DetailCard>
        );
      }
      return (
        <DetailCard label={label} title={item.title}>
          <Explain>Why it is here: {item.why}. Paste the PR or document that finished it, and the check closes.</Explain>
          <LinkChangeForm workItemId={item.subject.id} />
        </DetailCard>
      );
    case "commitment": {
      // Phase E, M22: the viewer's own promise; answering it here is the same as in the chat
      const [row] = await (await getDb()).select().from(t.commitments).where(eq(t.commitments.id, item.subject.id));
      if (!row || row.ownerId !== viewerId) return null;
      const check = item.cause === "commitment_check";
      return (
        <DetailCard label={label} title={item.title}>
          <Explain>
            Why it is here: {item.why}. Only you see your promises; nothing on a project changes when you answer.
          </Explain>
          <CommitmentButtons id={row.id} mode={check ? "check" : "stands"} today={todayIn(at)} dropFirst={check && asksDrop(row)} />
        </DetailCard>
      );
    }
    case "cover_request": {
      // Phase P, M35: what a teammate asks the viewer to cover while away; answering here is the same as in the chat
      const ask = await describeCoverAsk(await getDb(), viewerId, item.subject.id, at);
      if (!ask || ask.state !== "asked") return null;
      return (
        <DetailCard label={label} title={item.title}>
          <ul className="flex flex-col gap-1">
            {ask.items.map((i) => (
              <li key={i.key} className="type-body text-fg-1">
                {i.label} <span className="type-caption text-fg-3">{i.when}</span>
              </li>
            ))}
          </ul>
          <Explain>
            Why it is here: {item.why}. Accepting does not make the work yours: {firstName(ask.asker.name)} still owns it, and the handover lists each thing for you.
          </Explain>
          <CoverAnswerButtons id={ask.id} items={ask.items.map((i) => ({ key: i.key, label: i.label }))} />
        </DetailCard>
      );
    }
    case "capture":
      return (
        <DetailCard label={label} title={item.title}>
          <Explain>{item.why}.</Explain>
          <Link href={`/review/${item.subject.id}`} className="self-start rounded-control bg-inverse px-2.5 py-1 type-label text-on-inverse">
            Review
          </Link>
        </DetailCard>
      );
  }
}

/** M37 (section 20, U5 and U7): only the words that fed it, what it would change, and Accept or Decline. */
async function OwnerAskDetail({ item, label, askId }: { item: InboxEntry; label: string; askId: string }) {
  const ask = await describeOwnerAsk(await getDb(), askId);
  if (!ask) return null;
  const newWork = ask.record.kind === "new_work";
  return (
    <DetailCard label={label} title={item.title}>
      <Pair>
        <Box head={`From ${ask.author}'s update, ${clockTime(ask.at)}`}>
          <span className="type-caption text-fg-2">{ask.quote ? `"${ask.quote}."` : "Their words are no longer there."}</span>
        </Box>
        <Box head={newWork ? `New work on ${ask.project.name}` : ask.what}>
          <span className="type-caption text-fg-2">{ask.change}</span>
        </Box>
      </Pair>
      <Explain>
        {newWork
          ? `Accepting adds it to the plan as ${ask.author}'s, with no thread or due date yet. Nothing changes until you do.`
          : `Nothing changed when ${ask.author} saved. Accepting changes it as you; if it has changed since ${ask.author} said it, you are told and nothing is written.`}
      </Explain>
      <OwnerAskControls askId={askId} acceptLabel={newWork ? "Add to the plan" : "Accept"} />
    </DetailCard>
  );
}

/**
 * Phase K, M29: what Atlas noticed on one project that day, each from the data and never from anyone's words.
 * A PM or Lead accepts one as a risk (added to an open risk that already covers it, SG5) or dismisses it with
 * a reason; stale work's owner says it is still going (SG8). Each answer is checked when it runs.
 */
async function SignalsDetail({ item, label, projectId, day, viewerId, at }: { item: InboxEntry; label: string; projectId: string; day: string; viewerId: string; at: Date }) {
  const shown = await signalsFor(await getDb(), viewerId, projectId, day, at);
  if (!shown.length) return null;
  return (
    <DetailCard label={label} title={item.title}>
      <Explain>Nobody reported {shown.length === 1 ? "this" : "these"}: Atlas noticed {shown.length === 1 ? "it" : "them"} in the plan and the log. Nothing goes on the BRAID log until you accept it.</Explain>
      {shown.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md bg-panel-2 p-3">
          <span className="type-body text-fg-1">{s.text}</span>
          {s.earlier && <span className="type-caption text-fg-3">{s.earlier}</span>}
          {s.stage === "owner" && s.workItemId ? (
            <StillGoingControl workItemId={s.workItemId} />
          ) : (
            <SignalControls signalId={s.id} version={s.version} sameAs={s.sameAs} />
          )}
        </div>
      ))}
    </DetailCard>
  );
}

/** M17: a member asked to change an entry's kind; a PM or Lead switches it or keeps it with a reason. */
async function KindRequestDetail({ item, label, entryId, projectId, viewerId, at }: { item: InboxEntry; label: string; entryId: string; projectId: string; viewerId: string; at: Date }) {
  const db = await getDb();
  const view = await getProject(db, viewerId, projectId, at);
  if (!view.found) return null;
  const entry = view.braid.entries.find((e) => e.id === entryId);
  if (!entry?.request) return null;
  const r = entry.request;
  const asker = r.askedBy?.name.split(" ")[0] ?? "Someone";
  return (
    <DetailCard label={label} title={item.title}>
      <Pair>
        <Box head={`${entry.kindLabel} on the ${view.project.name} log`}>
          <span className="type-caption text-fg-2">
            {entry.title}: {entry.stateLabel.toLowerCase()}, {entry.reportCount} {entry.reportCount === 1 ? "report" : "reports"}
          </span>
        </Box>
        <Box head={`What ${asker} asked`}>
          <span className="type-caption text-fg-2">
            Make it {withArticle(KIND_LABEL[r.toKind].toLowerCase())}: &ldquo;{r.why}&rdquo;
          </span>
        </Box>
      </Pair>
      <Explain>Switching closes the {entry.kindLabel.toLowerCase()} and puts {withArticle(KIND_LABEL[r.toKind].toLowerCase())} on the log with every report. {asker} is told either way.</Explain>
      {entry.kindControl === "switch" && <KindRequestControls requestId={r.id} version={r.version} toLabel={KIND_LABEL[r.toKind]} mode="answer" />}
    </DetailCard>
  );
}

async function StatusDetail({ item, label, projectId, viewerId, at }: { item: InboxEntry; label: string; projectId: string; viewerId: string; at: Date }) {
  const db = await getDb();
  const view = await getProject(db, viewerId, projectId, at);
  if (!view.found || !view.setStatus) return null;
  const draft = await draftReason(db, projectId, at);
  const set = view.setStatus;
  const setter = set.setBy?.id === viewerId ? "you" : (set.setBy?.name.split(" ")[0] ?? "the owner");
  const worst = [...view.threads.flatMap((th) => th.milestones), ...view.unthreaded.milestones].find((m) => m.status === view.calculated.status);
  return (
    <DetailCard label={label} title={item.title}>
      <Pair>
        <Box head={`Set by ${setter}${set.setAt ? `, ${clockTime(set.setAt)}` : ""}`}>
          <StatusMark status={set.status} label={set.label} />
          <span className="type-caption text-fg-2">{view.reason ? (view.reason.stale ? `Reason ${view.reason.staleNote}` : "With a reason") : "No reason given yet"}</span>
        </Box>
        <Box head="Calculated from the plan">
          <StatusMark status={view.calculated.status} label={view.calculated.label} />
          {worst && <span className="type-caption text-fg-2">Worst milestone: {worst.name}, {worst.statusLabel.toLowerCase()}</span>}
        </Box>
      </Pair>
      <Explain>When they disagree, say why. The reason links to entries on the BRAID log, so the executive, the client view and the table all tell the same story.</Explain>
      <ReasonEditor
        projectId={projectId}
        calculatedLabel={view.calculated.label}
        setLabel={set.label}
        draft={{ text: view.reason?.text ?? draft.text, entryIds: view.reason?.links.map((l) => l.entryId) ?? draft.entryIds }}
        entries={view.braid.entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          kindLabel: e.kindLabel,
          title: e.reportCount > 1 ? `${e.title} (${e.reportCount} reports)` : e.title,
          stateLabel: e.waitingForApproval ? "Proposed" : e.stateLabel,
          onLog: e.onLog,
        }))}
        stale={!!view.reason?.stale}
      />
    </DetailCard>
  );
}

async function EntryDetail({ item, label, entryId, projectId, viewerId, at }: { item: InboxEntry; label: string; entryId: string; projectId: string; viewerId: string; at: Date }) {
  const db = await getDb();
  const view = await getProject(db, viewerId, projectId, at);
  if (!view.found) return null;
  // A drafted follow up (D10) is not on the project view yet; read it from the log
  if (item.cause === "follow_up") {
    const draft = (await loadBraidLog(db, projectId)).log[entryId];
    if (!draft) return null;
    const from = draft.links.find((l) => l.relation === "raised_from");
    const origin = from ? view.braid.entries.find((e) => e.id === from.entryId) : undefined;
    return (
      <DetailCard label={label} title={item.title}>
        {origin && (
          <Pair>
            <Box head={`${origin.kindLabel} on the ${view.project.name} log`}>
              <span className="type-caption text-fg-2">
                {origin.title}: {origin.stateLabel.toLowerCase()}
              </span>
            </Box>
            <Box head="What Atlas drafted">
              <span className="type-caption text-fg-2">
                {KIND_LABEL[draft.kind]}: {draft.title}
              </span>
            </Box>
          </Pair>
        )}
        <Explain>Nothing goes on the log by itself. Add it as drafted, or drop it.</Explain>
        <FollowUpControls entryId={entryId} />
      </DetailCard>
    );
  }
  const entry = view.braid.entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const reporter = entry.reportedBy?.name.split(" ")[0] ?? "the reporter";
  const words = entry.sources.find((s) => s.quote && s.person.id === entry.reportedBy?.id) ?? entry.sources.find((s) => s.quote);
  const sameKind = view.braid.entries.filter((e) => e.kind === entry.kind && e.id !== entry.id && e.onLog);
  const related = entry.links.map((l) => `${KIND_LABEL[l.kind]} · ${l.title}`);
  const said = entry.outcomesProposed;
  // Section 20, U4: a reversal names the decision it replaces
  const replaces = entry.links.filter((l) => l.relation === "conflicts_with" && l.kind === "decision");

  const source = (
    <Box head={words ? `From ${words.person.name.split(" ")[0]}'s update, ${clockTime(words.at)}` : `Reported by ${entry.reportedBy?.name ?? "someone"}`}>
      <span className="type-caption text-fg-2">
        {words ? `"${words.quote}." ${words.person.name.split(" ")[0]} confirmed this on review.` : `${entry.reportCount} ${entry.reportCount === 1 ? "report" : "reports"}.`}
      </span>
    </Box>
  );
  const similar = (
    <Box head={entry.kind === "decision" ? `Decisions on the ${view.project.name} log` : `Already on the ${view.project.name} log`}>
      <span className="type-caption text-fg-2">
        {entry.kind === "decision"
          ? replaces.length
            ? `It replaces ${replaces.map((l) => `"${l.title}" (${l.stateLabel.toLowerCase()})`).join(" and ")}. Approving it supersedes ${replaces.length === 1 ? "that one if it is approved" : "those that are approved"}; a pending one stays for you to decide.`
            : `${sameKind.length ? "None conflict." : "None yet."} Atlas checked ${sameKind.length} approved ${sameKind.length === 1 ? "decision" : "decisions"}.`
          : `${entry.reportCount > 1 ? `Reported ${entry.reportCount} times.` : "Nothing like it."} Atlas checked ${sameKind.length} open ${KIND_LABEL[entry.kind].toLowerCase()}${sameKind.length === 1 ? "" : "s"}.`}
      </span>
    </Box>
  );

  if (item.cause === "approve" || item.cause === "no_decider") {
    return (
      <DetailCard label={label} title={item.title}>
        <Pair>
          {source}
          {similar}
        </Pair>
        <Explain>
          {entry.kind === "decision"
            ? `A decision stays pending until a PM or Lead approves it. "We agreed" in a message does not approve it.`
            : `Anyone on the project can raise a ${KIND_LABEL[entry.kind].toLowerCase()}. Only a PM or Lead puts it on the log. Once you approve it, you can link it in a reason.`}
        </Explain>
        {item.cause === "approve" ? <DecideControls entryId={entryId} reporter={reporter} related={related} /> : <Explain>Nobody on the project holds the right to approve it. Assign a PM or Lead.</Explain>}
      </DetailCard>
    );
  }
  return (
    <DetailCard label={label} title={item.title}>
      <Pair>
        {source}
        <Box head="Where it is">
          <span className="type-caption text-fg-2">
            {entry.kindLabel} · {entry.stateLabel}
            {entry.owner ? ` · owner ${entry.owner.name.split(" ")[0]}` : ""}
          </span>
        </Box>
      </Pair>
      <Explain>
        {item.cause === "confirm_outcome"
          ? "Words in an update only tell you; nothing ends until a PM or Lead decides. Whoever said it is told if you keep it open."
          : item.cause === "dependency_due"
          ? "Only a PM or Lead ends a dependency. DPM never marks it late by itself."
          : item.cause === "blocker_new"
          ? "A blocker went on the log; it stops work until it is cleared."
          : item.cause === "more_info"
            ? "Answer the question in your chat; the entry goes back to the PM or Lead."
            : "Only the owner of the blocked work, or a PM or Lead, resolves a blocker. Anyone else's \"it's cleared\" comes here."}
      </Explain>
      {item.cause === "clear" || item.cause === "confirm_clear" ? (
        <ClearControls entryId={entryId} canKeepOpen={item.cause === "clear"} />
      ) : item.cause === "blocker_new" ? (
        <AcknowledgeControl entryId={entryId} />
      ) : item.cause === "dependency_due" ? (
        <DependencyDueControls entryId={entryId} />
      ) : item.cause === "confirm_outcome" ? (
        <OutcomeControls entryId={entryId} choices={outcomeChoices(entry.kind, said)} />
      ) : null}
    </DetailCard>
  );
}

async function LeaveDetail({ item, label, leaveId, projectId, viewerId }: { item: InboxEntry; label: string; leaveId: string; projectId: string; viewerId: string }) {
  const db = await getDb();
  const impact = await getLeaveImpact(db, viewerId, leaveId, projectId);
  if (!impact.found) return null;
  const [leave] = await db.select({ state: t.leave.state }).from(t.leave).where(eq(t.leave.id, leaveId));
  const lines = [
    ...impact.workItems.map((w) => `${w.number ?? ""} ${w.title}${w.state === "blocked" ? " (blocked)" : ""}`.trim()),
    ...impact.milestones.map((m) => `Milestone ${m.name}, due ${m.due}`),
    ...impact.handoverSteps.map((s) => `Handover: ${s.title} to ${s.to.name.split(" ")[0]}, not done`),
    ...impact.braid.map((e) => `${KIND_LABEL[e.kind as keyof typeof KIND_LABEL]}: ${e.title}`),
  ];
  return (
    <DetailCard label={label} title={item.title}>
      <Pair>
        <Box head={`${impact.person.name}${impact.change ? ", a change to approved leave" : ""}`}>
          <span className="type-body-medium text-fg-1">{impact.askedLabel}</span>
        </Box>
        <Box head={`What it touches in ${impact.project.name}`}>
          <span className="type-caption text-fg-2">{lines.length ? `${lines.length} to cover` : "Nothing to cover"}</span>
        </Box>
      </Pair>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l} className="type-body text-fg-1">
              {l}
            </li>
          ))}
        </ul>
      )}
      <Explain>Only this project&apos;s part is shown here, and never a reason for the leave.</Explain>
      {impact.mayDecide && leave?.state && <LeaveControls leaveId={leaveId} />}
    </DetailCard>
  );
}
