// The browser story's own data, on top of the 20 Oct snapshot (`pnpm db:reset --e2e`, run by `pnpm e2e`).
// The snapshot stays as the unit tests know it; only what a story step needs and the snapshot has not is here.
import type { Db } from "../client";
import * as t from "../schema";

/**
 * CD50, PP2: a second Kemar, on GQ & Academy, so "What is Kemar working on?" fits two of the people Alicia
 * shares a project with and Atlas asks who. GQ has no work yet, so nothing else in the story changes.
 */
export async function seedE2e(db: Db): Promise<void> {
  await db.insert(t.people).values({ id: "kemar-lee", name: "Kemar Lee", initials: "KL", title: "Trainer", orgRole: "employee" });
  await db.insert(t.projectMemberships).values({ projectId: "gq", personId: "kemar-lee", state: "member", role: "member" });
}
