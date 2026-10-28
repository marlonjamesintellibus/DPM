// Decision CD49 (W3-D11): a PM turns an outside contact's client view on or off, from the project's contacts.
// The switch is domain/machines/client-view.ts; what the view shows is queries/client-view.ts (phase Q,
// EX4). The right is read when the command runs (rule 7), so a PM who left, or a member who is not the PM,
// is refused even with the button still on their screen. A project the actor cannot open now reads as not
// found and names nothing (P10). Turning it off takes effect on the contact's next question: their answers
// read the flag every time.
import { and, eq } from "drizzle-orm";
import { loadWorld, orgTagsOf } from "../db/records";
import * as t from "../db/schema";
import { clientViewState, switchClientView, type ClientViewRecord } from "../domain/machines/client-view";
import { isCandidate } from "../domain/machines/membership";
import { audit, CommandRefused, expectOne, moved, runCommand, type CommandCtx } from "./core";

export function setClientView(ctx: CommandCtx, projectId: string, personId: string, on: boolean): Promise<ClientViewRecord> {
  return runCommand(ctx, async (tx) => {
    const world = await loadWorld(tx);
    // P10: someone who cannot open the project hears the same words whatever is true of it, or of the contact
    if (!isCandidate(ctx.actorId, await orgTagsOf(tx, ctx.actorId), projectId, world)) throw new CommandRefused("not one of your projects", "not_found");
    const [row] = await tx
      .select({ clientView: t.projectContacts.clientView, name: t.people.name, orgRole: t.people.orgRole, project: t.projects.name })
      .from(t.projectContacts)
      .innerJoin(t.people, eq(t.people.id, t.projectContacts.personId))
      .innerJoin(t.projects, eq(t.projects.id, t.projectContacts.projectId))
      .where(and(eq(t.projectContacts.projectId, projectId), eq(t.projectContacts.personId, personId)));
    if (!row) throw new CommandRefused("they are not a contact on this project", "not_found");

    const role = world.memberships.find((m) => m.projectId === projectId && m.personId === ctx.actorId && m.state === "member")?.role;
    const before: ClientViewRecord = { projectId, personId, state: clientViewState(row.clientView) };
    const r = switchClientView(before, { type: on ? "TURN_ON" : "TURN_OFF" }, ctx.actorId, { byPm: role === "pm", outside: row.orgRole === null });
    if (!r.outcome.ok) throw new CommandRefused(r.outcome.reason.replace(/^it is/, `${row.name.split(" ")[0]}'s client view is`), role === "pm" ? "refused" : "not_allowed");
    const outcome = moved(r.outcome);

    // The flag as read: a PM who moved it first since makes this one stale, never overwritten
    const updated = await tx
      .update(t.projectContacts)
      .set({ clientView: r.record.state === "on" })
      .where(and(eq(t.projectContacts.projectId, projectId), eq(t.projectContacts.personId, personId), eq(t.projectContacts.clientView, row.clientView)))
      .returning({ personId: t.projectContacts.personId });
    expectOne(updated, `${row.name}'s client view on ${row.project}`);
    // On the project's trail (its members already see its contacts, CD9), with who it was for
    await audit(tx, ctx.now, {
      actorType: "person",
      actorId: ctx.actorId,
      action: r.audit!.action,
      machine: "client_view",
      subjectType: "project_contact",
      subjectId: projectId,
      fromState: outcome.from,
      toState: outcome.to,
      detail: { personId },
    });
    return r.record;
  });
}
