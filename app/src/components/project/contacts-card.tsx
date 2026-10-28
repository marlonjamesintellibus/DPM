// The project's contacts (KB A7.3) and, for each outside contact, whether they can see its client view
// (decision CD49). Every member reads the list; only the PM has the switch, and the command checks it again.
// What the client view shows is said in plain words, as queries/client-view.ts builds it (phase Q, EX4).
import { Card } from "@/components/ui/card";
import { ClientViewControl } from "./client-view-control";
import type { ProjectContact } from "@/queries/client-view";

export function ContactsCard({ projectId, projectName, contacts, isPm }: { projectId: string; projectName: string; contacts: ProjectContact[]; isPm: boolean }) {
  const outside = contacts.some((c) => c.outside);
  return (
    <Card label="Contacts" className="shrink-0 xl:w-[520px] xl:self-start" bodyClassName="gap-2.5">
      {contacts.map((c) => {
        const first = c.person.name.split(" ")[0];
        return (
          <div key={c.person.id} className="flex items-center gap-3 border-b border-line pb-2.5 last:border-b-0 last:pb-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="type-body-medium text-fg-1">{c.person.name}</span>
              <span className="type-caption text-fg-3">{c.tie}</span>
              <span className="type-caption text-fg-2">
                {!c.outside ? "In the org, so no client view" : c.clientView ? `${first} can see the client view` : `${first} cannot see the client view`}
              </span>
            </div>
            {isPm && c.outside && <ClientViewControl projectId={projectId} personId={c.person.id} firstName={first} on={c.clientView} />}
          </div>
        );
      })}
      {contacts.length === 0 && <p className="type-caption text-fg-3">No contacts on this project yet. A PM or Lead adds one by approving a correction to an update.</p>}
      {outside && (
        <p className="type-caption text-fg-3">
          With the client view, an outside contact can ask Atlas what {projectName} is and hears only its name, customer, dates and releases with their target dates. Never its
          status, people, work or decisions.
        </p>
      )}
    </Card>
  );
}
