// M14. Routing one extracted item (Switch), the recheck when Save runs (rule 7), and who may read
// an item's quote (rule 9). Port of research/state-machines/js/models/routing.mjs (model checked 26 Oct).
// The model's finding: routing needs two layers. Check 9 runs every time an item is routed, by
// Atlas or by the author, so the review page never offers a project the author is not in; and
// membership is checked again at Save, because the author can leave or a group can be disconnected
// in between. Either alone is not enough.
import { defineMachine, transition, type Outcome } from "./machine";
import { isCandidate, isMember, type World } from "./machines/membership";
import type { ItemKind, RoutingState, SourceSpan } from "./shared";

export const ROUTING_STATES = ["routed", "choose_project", "not_filed"] as const satisfies readonly RoutingState[];

/** The capture's author, with the org tags their Atlas account is linked to. */
export type Author = { personId: string; orgTags: readonly string[] };

export type Route = {
  state: RoutingState;
  /** personal: routed to "You" (leave), never to a project (E80). */
  scope: "project" | "personal";
  /** Set only when routed to a project. */
  projectId: string | null;
  /** choose_project: the projects the card offers. */
  options: readonly string[];
  /** Shown on the card ("#151", "you said 'On Store Insights'"). */
  reason: string;
};

/** What Atlas proposed. Untrusted: routeFromAtlas decides what DPM does with it. */
export type AtlasGuess =
  | { kind: "project"; projectId: string; reason: string }
  | { kind: "ambiguous"; projectIds: readonly string[]; reason: string }
  | { kind: "personal"; reason: string }
  | { kind: "none" };

const NO_FIT = "None of your projects fits; only you can see this";

const notFiled = (reason: string): Route => ({ state: "not_filed", scope: "project", projectId: null, options: [], reason });
const routedTo = (projectId: string, reason: string): Route => ({ state: "routed", scope: "project", projectId, options: [], reason });

/** Server check 9 on Atlas's guess: an item is routed only to a candidate, otherwise it is not filed. */
export function routeFromAtlas(guess: AtlasGuess, author: Author, world: World): Route {
  const fits = (p: string) => isCandidate(author.personId, author.orgTags, p, world);
  switch (guess.kind) {
    case "personal":
      return { state: "routed", scope: "personal", projectId: null, options: [], reason: guess.reason };
    case "project": {
      if (fits(guess.projectId)) return routedTo(guess.projectId, guess.reason);
      // E75: name the project only when the author is in it, so the reason leaks nothing (E78)
      const project = world.projects.find((p) => p.id === guess.projectId);
      if (project && isMember(author.personId, project.id, world.memberships) && !project.connected) {
        return notFiled(`${project.name} isn't connected to DPM yet`);
      }
      return notFiled(NO_FIT);
    }
    case "ambiguous": {
      const options = [...new Set(guess.projectIds)].filter(fits);
      if (!options.length) return notFiled(NO_FIT);
      return { state: "choose_project", scope: "project", projectId: null, options, reason: guess.reason };
    }
    default:
      return notFiled(NO_FIT);
  }
}

export type RoutingEvent =
  | { type: "MOVE"; projectId: string } // routed: the author moves it to another of their projects
  | { type: "PICK"; projectId: string } // choose_project: the author picks one
  | { type: "FILE"; projectId: string } // not_filed: the author files it after all
  | { type: "KEEP_PRIVATE" };

type Ctx = { route: Route; author: Author; world: World };

// Every move into a project re-runs check 9 against memberships as they are now
function intoProject({ route, author, world }: Ctx, projectId: string): string | null {
  if (route.scope === "personal") return "personal items stay with you";
  if (projectId === route.projectId) return "already filed there";
  return isCandidate(author.personId, author.orgTags, projectId, world) ? null : "not one of your projects connected to DPM";
}

export const routingMachine = defineMachine<RoutingState, RoutingEvent, Ctx>({
  name: "routing",
  states: ROUTING_STATES,
  arrows: [
    { from: ["routed"], on: "MOVE", to: "routed", guard: (ctx, e) => intoProject(ctx, e.projectId) },
    { from: ["choose_project"], on: "PICK", to: "routed", guard: (ctx, e) => intoProject(ctx, e.projectId) },
    { from: ["not_filed"], on: "FILE", to: "routed", guard: (ctx, e) => intoProject(ctx, e.projectId) },
    {
      from: ["routed", "choose_project"],
      on: "KEEP_PRIVATE",
      to: "not_filed",
      guard: ({ route }) => (route.scope === "personal" ? "personal items are already private" : null),
    },
  ],
});

/** For check 10: the item's kind, and the project of its record target or matched BRAID entry. */
export type RoutedItemTarget = { kind: ItemKind; targetProjectId: string | null };

export type RoutingResult = {
  outcome: Outcome<RoutingState>;
  route: Route;
  /**
   * Check 10 after a move (E74). pick_target: the update's record is not in the new project, so the
   * author picks a target there or offers it as a BRAID item. rematch: a "same as" entry is in
   * another project, so the match goes back to the author.
   */
  recheck: "pick_target" | "rematch" | null;
};

const MOVE_REASON: Record<string, string> = { MOVE: "You moved it here", PICK: "You picked this project", FILE: "You filed it here" };

/**
 * Applies the author's routing choice to one item. A refused event returns the route unchanged.
 * The caller routes only while the capture is in review (M2).
 */
export function applyRouting(
  route: Route,
  event: RoutingEvent,
  author: Author,
  world: World,
  item?: RoutedItemTarget,
): RoutingResult {
  const outcome = transition(routingMachine, route.state, event, { route, author, world });
  if (!outcome.ok) return { outcome, route, recheck: null };
  if (event.type === "KEEP_PRIVATE") return { outcome, route: notFiled("You kept it private"), recheck: null };
  const next = routedTo(event.projectId, MOVE_REASON[event.type]);
  let recheck: RoutingResult["recheck"] = null;
  if (item && item.targetProjectId !== next.projectId) {
    if (item.kind === "update") recheck = "pick_target";
    if (item.kind === "braid_same") recheck = "rematch";
  }
  return { outcome, route: next, recheck };
}

export type SavePlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      filed: { ordinal: number; projectId: string }[];
      /** E77, rule 7: routed to a project the author is no longer a candidate for when Save runs. */
      withdrawn: { ordinal: number; projectId: string; reason: string }[];
      personal: number[];
      /** S16: saved, and private to the author. */
      notFiled: number[];
    };

/**
 * What Save does with each item's routing, checked when Save runs. Refused while any item still
 * needs a project (NothingFiledWhileChoosing); otherwise the rest saves normally.
 */
export function planRoutingAtSave(items: readonly { ordinal: number; route: Route }[], author: Author, world: World): SavePlan {
  const choosing = items.filter((i) => i.route.state === "choose_project").length;
  if (choosing) return { ok: false, reason: `${choosing} ${choosing === 1 ? "needs" : "need"} a project before this is saved` };
  const plan: Extract<SavePlan, { ok: true }> = { ok: true, filed: [], withdrawn: [], personal: [], notFiled: [] };
  for (const { ordinal, route } of items) {
    if (route.scope === "personal") plan.personal.push(ordinal);
    else if (route.state !== "routed" || route.projectId === null) plan.notFiled.push(ordinal);
    else if (isCandidate(author.personId, author.orgTags, route.projectId, world)) {
      plan.filed.push({ ordinal, projectId: route.projectId });
    } else {
      plan.withdrawn.push({ ordinal, projectId: route.projectId, reason: "you are no longer a member, or it is no longer connected to DPM" });
    }
  }
  return plan;
}

/** A person reading an org's dashboard. */
export type Reader = { personId: string; orgTag: string };

/** A saved item as visibility sees it. filedInto is set by Save; null for personal, not filed and withdrawn items. */
export type SavedItem = { ordinal: number; authorId: string; filedInto: string | null; spans: readonly SourceSpan[] };

/**
 * Rule 9. A filed item's quote is seen by members of its project, on that project's org dashboard
 * only (NoCrossProjectQuote, NoCrossOrg). Anything not filed into a project is its author's alone.
 */
export function maySeeQuote(reader: Reader, item: SavedItem, world: World): boolean {
  if (item.filedInto === null) return reader.personId === item.authorId;
  const project = world.projects.find((p) => p.id === item.filedInto);
  return project !== undefined && project.orgTag === reader.orgTag && isMember(reader.personId, project.id, world.memberships);
}

/** The whole capture belongs to its author; project members read only quotes (M1). */
export function mayReadCapture(reader: { personId: string }, capture: { authorId: string }): boolean {
  return reader.personId === capture.authorId;
}

/** The items of a capture a reader may see, each judged on its own project, never on the capture's. */
export function visibleItems<T extends SavedItem>(reader: Reader, items: readonly T[], world: World): T[] {
  return items.filter((i) => maySeeQuote(reader, i, world));
}

/** The quote spans a project may see: those of items filed into it. One quote may feed several items (E73). */
export function projectSpans(projectId: string, items: readonly SavedItem[]): SourceSpan[] {
  const seen = new Map<string, SourceSpan>();
  for (const i of items) {
    if (i.filedInto !== projectId) continue;
    for (const s of i.spans) seen.set(`${s.start}:${s.end}`, { start: s.start, end: s.end });
  }
  return [...seen.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
