import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyMembership, candidateProjects, isCandidate, type MembershipRecord, type ProjectRef, type World } from "./machines/membership";
import {
  applyRouting,
  mayReadCapture,
  maySeeQuote,
  planRoutingAtSave,
  projectSpans,
  routeFromAtlas,
  visibleItems,
  type AtlasGuess,
  type Author,
  type Reader,
  type Route,
  type RoutingEvent,
  type SavedItem,
} from "./routing";

// The model's world (research/state-machines/js/models/routing.mjs): Kemar's groups, plus one
// project he is not in, one not connected to DPM, and one tagged to another company.
const PROJECTS: ProjectRef[] = [
  { id: "forager", name: "Forager 2.0", orgTag: "A", connected: true },
  { id: "insights", name: "Store Insights", orgTag: "A", connected: true },
  { id: "sante", name: "Sante Group", orgTag: "A", connected: true }, // Kemar is not a member
  { id: "study", name: "UWI Mona study group", orgTag: "A", connected: false },
  { id: "partner", name: "Partner project", orgTag: "B", connected: true },
];
const NAMES = PROJECTS.map((p) => p.id);
const m = (personId: string, projectId: string, role: MembershipRecord["role"] = "member"): MembershipRecord => ({
  projectId,
  personId,
  state: "member",
  role,
});
const MEMBERSHIPS: MembershipRecord[] = [
  ...["forager", "insights", "partner", "study"].map((p) => m("kemar", p)),
  m("alicia", "forager", "pm"),
  m("alicia", "partner"),
  m("andre", "insights", "pm"),
  m("bob", "partner"),
];
const WORLD: World = { memberships: MEMBERSHIPS, projects: PROJECTS };
const KEMAR: Author = { personId: "kemar", orgTags: ["A", "B"] };
const READERS: Reader[] = [
  { personId: "alicia", orgTag: "A" },
  { personId: "andre", orgTag: "A" },
  { personId: "bob", orgTag: "B" },
  { personId: "kemar", orgTag: "A" },
  { personId: "kemar", orgTag: "B" },
];
const ALICIA = READERS[0];
const ANDRE = READERS[1];
const BOB = READERS[2];

const atlas = (guess: AtlasGuess, world: World = WORLD) => routeFromAtlas(guess, KEMAR, world);
const toProject = (projectId: string, reason = "Atlas") => atlas({ kind: "project", projectId, reason });
const without = (world: World, personId: string, projectId: string): World => ({
  ...world,
  memberships: world.memberships.map((x) =>
    x.personId === personId && x.projectId === projectId ? applyMembership(x, { type: "LEAVE" }, personId).record : x,
  ),
});
const disconnected = (world: World, projectId: string): World => ({
  ...world,
  projects: world.projects.map((p) => (p.id === projectId ? { ...p, connected: false } : p)),
});

/** The author's routing move into a project: MOVE, PICK or FILE by the item's state. */
function intoProject(route: Route, projectId: string): RoutingEvent {
  if (route.state === "routed") return { type: "MOVE", projectId };
  if (route.state === "choose_project") return { type: "PICK", projectId };
  return { type: "FILE", projectId };
}

/** Save, then the items as visibility sees them. */
function save(routes: Route[], world: World = WORLD, spans: SavedItem["spans"][] = routes.map((_, i) => [{ start: i * 10, end: i * 10 + 9 }])) {
  const plan = planRoutingAtSave(routes.map((route, ordinal) => ({ ordinal, route })), KEMAR, world);
  if (!plan.ok) throw new Error(plan.reason);
  const items: SavedItem[] = routes.map((_, ordinal) => ({
    ordinal,
    authorId: "kemar",
    filedInto: plan.filed.find((f) => f.ordinal === ordinal)?.projectId ?? null,
    spans: spans[ordinal],
  }));
  return { plan, items };
}

describe("candidate projects (M13, check 9)", () => {
  it("are the projects Kemar is a member of, connected to DPM, in one of his orgs", () => {
    expect(candidateProjects("kemar", ["A", "B"], WORLD)).toEqual(["forager", "insights", "partner"]);
    expect(candidateProjects("kemar", ["A"], WORLD)).toEqual(["forager", "insights"]);
  });

  it("invited, requested and left memberships do not count", () => {
    for (const state of ["invited", "requested", "left"] as const) {
      const world = { ...WORLD, memberships: [{ ...m("kemar", "forager"), state }] };
      expect(isCandidate("kemar", ["A"], "forager", world)).toBe(false);
    }
  });
});

describe("routing arrows", () => {
  it("Atlas's guess becomes routed, choose_project or not_filed", () => {
    expect(toProject("forager", "#151")).toMatchObject({ state: "routed", projectId: "forager", reason: "#151" });
    expect(atlas({ kind: "ambiguous", projectIds: ["forager", "insights"], reason: "the pipeline" })).toMatchObject({
      state: "choose_project",
      options: ["forager", "insights"],
    });
    expect(atlas({ kind: "none" })).toMatchObject({ state: "not_filed", projectId: null });
    expect(atlas({ kind: "personal", reason: "Personal" })).toMatchObject({ state: "routed", scope: "personal", projectId: null });
  });

  it("the author moves a routed item to another of their projects", () => {
    const r = applyRouting(toProject("forager"), { type: "MOVE", projectId: "insights" }, KEMAR, WORLD);
    expect(r.outcome).toMatchObject({ ok: true, from: "routed", to: "routed" });
    expect(r.route).toMatchObject({ state: "routed", projectId: "insights", reason: "You moved it here" });
  });

  it("the author picks a project for an ambiguous item", () => {
    const choose = atlas({ kind: "ambiguous", projectIds: ["forager", "insights"], reason: "the pipeline" });
    expect(applyRouting(choose, { type: "PICK", projectId: "insights" }, KEMAR, WORLD).route).toMatchObject({ state: "routed", projectId: "insights" });
  });

  it("the author files a private item, and keeps a routed or ambiguous one private", () => {
    expect(applyRouting(atlas({ kind: "none" }), { type: "FILE", projectId: "forager" }, KEMAR, WORLD).route.projectId).toBe("forager");
    const choose = atlas({ kind: "ambiguous", projectIds: ["forager", "insights"], reason: "" });
    for (const route of [toProject("forager"), choose]) {
      expect(applyRouting(route, { type: "KEEP_PRIVATE" }, KEMAR, WORLD).route).toMatchObject({ state: "not_filed", projectId: null });
    }
  });

  it("every move into a project re-checks that it is a candidate, and a refusal changes nothing", () => {
    const route = toProject("forager");
    for (const p of ["sante", "study", "nowhere"]) {
      const r = applyRouting(route, { type: "MOVE", projectId: p }, KEMAR, WORLD);
      expect(r.outcome.ok).toBe(false);
      expect(r.route).toBe(route);
    }
    // Kemar left Store Insights after Atlas routed: moving there now is refused (rule 7)
    expect(applyRouting(route, { type: "MOVE", projectId: "insights" }, KEMAR, without(WORLD, "kemar", "insights")).outcome.ok).toBe(false);
  });

  it("refuses arrows that are not drawn", () => {
    expect(applyRouting(toProject("forager"), { type: "PICK", projectId: "insights" }, KEMAR, WORLD).outcome.ok).toBe(false);
    expect(applyRouting(toProject("forager"), { type: "MOVE", projectId: "forager" }, KEMAR, WORLD).outcome.ok).toBe(false);
    expect(applyRouting(atlas({ kind: "none" }), { type: "KEEP_PRIVATE" }, KEMAR, WORLD).outcome.ok).toBe(false);
    expect(applyRouting(atlas({ kind: "none" }), { type: "MOVE", projectId: "forager" }, KEMAR, WORLD).outcome.ok).toBe(false);
  });

  it("personal items stay with the author", () => {
    const leave = atlas({ kind: "personal", reason: "Personal" });
    expect(applyRouting(leave, { type: "MOVE", projectId: "forager" }, KEMAR, WORLD).outcome.ok).toBe(false);
    expect(applyRouting(leave, { type: "KEEP_PRIVATE" }, KEMAR, WORLD).outcome.ok).toBe(false);
  });
});

describe("save-time recheck (rule 7)", () => {
  it("refuses Save while an item still needs a project (E20, NothingFiledWhileChoosing)", () => {
    const choose = atlas({ kind: "ambiguous", projectIds: ["forager", "insights"], reason: "" });
    expect(planRoutingAtSave([{ ordinal: 0, route: toProject("forager") }, { ordinal: 1, route: choose }], KEMAR, WORLD)).toEqual({
      ok: false,
      reason: "1 needs a project before this is saved",
    });
  });

  it("withdraws items routed to a project that was disconnected before Save", () => {
    const { plan } = save([toProject("forager"), toProject("insights")], disconnected(WORLD, "insights"));
    expect(plan).toMatchObject({ filed: [{ ordinal: 0, projectId: "forager" }], withdrawn: [{ ordinal: 1, projectId: "insights" }] });
  });
});

describe("routing and visibility edge cases", () => {
  it("E70 an item that names a project, customer or issue number is routed there with the reason", () => {
    expect(toProject("insights", "you said 'On Store Insights'")).toMatchObject({
      state: "routed",
      projectId: "insights",
      reason: "you said 'On Store Insights'",
    });
  });

  it("E71 an item that fits two projects waits for the author, and Save is refused until he picks or keeps it private", () => {
    const choose = atlas({ kind: "ambiguous", projectIds: ["forager", "insights"], reason: "fixed the pipeline" });
    expect(choose.options).toEqual(["forager", "insights"]);
    expect(planRoutingAtSave([{ ordinal: 0, route: choose }], KEMAR, WORLD).ok).toBe(false);
    const picked = applyRouting(choose, { type: "PICK", projectId: "forager" }, KEMAR, WORLD).route;
    expect(planRoutingAtSave([{ ordinal: 0, route: picked }], KEMAR, WORLD)).toMatchObject({ ok: true, filed: [{ ordinal: 0, projectId: "forager" }] });
    const kept = applyRouting(choose, { type: "KEEP_PRIVATE" }, KEMAR, WORLD).route;
    expect(planRoutingAtSave([{ ordinal: 0, route: kept }], KEMAR, WORLD)).toMatchObject({ ok: true, notFiled: [0] });
  });

  it("E71 an ambiguous guess offers only the author's candidates", () => {
    expect(atlas({ kind: "ambiguous", projectIds: ["forager", "sante", "study"], reason: "" }).options).toEqual(["forager"]);
    expect(atlas({ kind: "ambiguous", projectIds: ["sante", "study"], reason: "" }).state).toBe("not_filed");
  });

  it("E72 an item that fits no project is not filed, savable, and private to the author (S16)", () => {
    const { plan, items } = save([atlas({ kind: "none" })]);
    expect(plan).toMatchObject({ ok: true, notFiled: [0], filed: [] });
    for (const r of READERS) expect(maySeeQuote(r, items[0], WORLD)).toBe(r.personId === "kemar");
  });

  it("E73 one sentence for two projects is two items with the same quote, one per project", () => {
    const quote = { start: 40, end: 98 };
    const { items } = save([toProject("forager"), toProject("insights")], WORLD, [[quote], [quote]]);
    expect(projectSpans("forager", items)).toEqual([quote]);
    expect(projectSpans("insights", items)).toEqual([quote]);
    expect(visibleItems(ALICIA, items, WORLD).map((i) => i.ordinal)).toEqual([0]);
    expect(visibleItems(ANDRE, items, WORLD).map((i) => i.ordinal)).toEqual([1]);
  });

  it("E74 moved to a project where the target does not exist: the author picks a target there", () => {
    const update = { kind: "update" as const, targetProjectId: "forager" };
    expect(applyRouting(toProject("forager"), { type: "MOVE", projectId: "insights" }, KEMAR, WORLD, update).recheck).toBe("pick_target");
    const same = { kind: "braid_same" as const, targetProjectId: "forager" };
    expect(applyRouting(toProject("forager"), { type: "MOVE", projectId: "insights" }, KEMAR, WORLD, same).recheck).toBe("rematch");
    const fresh = { kind: "braid_new" as const, targetProjectId: null };
    expect(applyRouting(toProject("forager"), { type: "MOVE", projectId: "insights" }, KEMAR, WORLD, fresh).recheck).toBeNull();
    // Moving back to where the target lives needs nothing more
    expect(applyRouting(toProject("insights"), { type: "MOVE", projectId: "forager" }, KEMAR, WORLD, update).recheck).toBeNull();
  });

  it("E75 a project whose group is not connected to DPM is not a candidate, and the reason names it", () => {
    expect(toProject("study")).toMatchObject({ state: "not_filed", reason: "UWI Mona study group isn't connected to DPM yet" });
  });

  it("E76 an item filed into org B's project never appears on org A's dashboard", () => {
    const { items } = save([toProject("partner")]);
    expect(items[0].filedInto).toBe("partner");
    expect(maySeeQuote(BOB, items[0], WORLD)).toBe(true);
    expect(maySeeQuote(ALICIA, items[0], WORLD)).toBe(false); // a partner member, reading org A's dashboard
    expect(maySeeQuote({ personId: "alicia", orgTag: "B" }, items[0], WORLD)).toBe(true);
  });

  it("E76 a project in an org the author is not linked to is not a candidate", () => {
    expect(routeFromAtlas({ kind: "project", projectId: "partner", reason: "" }, { personId: "kemar", orgTags: ["A"] }, WORLD).state).toBe(
      "not_filed",
    );
  });

  it("E77 Kemar leaves a project between capture and save: items routed there are withdrawn, the rest save", () => {
    const routes = [toProject("forager"), toProject("insights"), atlas({ kind: "personal", reason: "Personal" })];
    const { plan, items } = save(routes, without(WORLD, "kemar", "forager"));
    expect(plan).toMatchObject({
      filed: [{ ordinal: 1, projectId: "insights" }],
      withdrawn: [{ ordinal: 0, projectId: "forager" }],
      personal: [2],
    });
    expect(items[0].filedInto).toBeNull();
    expect(maySeeQuote(ALICIA, items[0], WORLD)).toBe(false);
  });

  it("E78 a project Kemar is not in is never routed to, and the reason does not name it", () => {
    const r = toProject("sante", "Sante Group is late");
    expect(r).toMatchObject({ state: "not_filed", projectId: null });
    expect(r.reason).not.toContain("Sante");
  });

  it("E79 Alicia opening a Forager source sees the Forager quote only, never the other sentence or the note", () => {
    const { items } = save([toProject("forager"), toProject("insights")], WORLD, [[{ start: 0, end: 120 }], [{ start: 121, end: 200 }]]);
    expect(visibleItems(ALICIA, items, WORLD).flatMap((i) => i.spans)).toEqual([{ start: 0, end: 120 }]);
    expect(projectSpans("forager", items)).toEqual([{ start: 0, end: 120 }]);
    expect(mayReadCapture(ALICIA, { authorId: "kemar" })).toBe(false);
    expect(mayReadCapture({ personId: "kemar" }, { authorId: "kemar" })).toBe(true);
  });

  it("E80 a personal item routes to You and is not seen by project members", () => {
    const { plan, items } = save([atlas({ kind: "personal", reason: "Personal" })]);
    expect(plan).toMatchObject({ personal: [0], filed: [] });
    for (const r of READERS) expect(maySeeQuote(r, items[0], WORLD)).toBe(r.personId === "kemar");
  });

  it("E81 a group with no project (Data guild) is not a routing target", () => {
    expect(toProject("data-guild")).toMatchObject({ state: "not_filed", reason: "None of your projects fits; only you can see this" });
    expect(applyRouting(atlas({ kind: "none" }), { type: "FILE", projectId: "data-guild" }, KEMAR, WORLD).outcome.ok).toBe(false);
  });

  it("E82 two projects with the same issue title: an explicit number routes, without one the author chooses", () => {
    expect(toProject("forager", "#151")).toMatchObject({ state: "routed", projectId: "forager" });
    expect(atlas({ kind: "ambiguous", projectIds: ["forager", "insights"], reason: "Store sales feed" }).state).toBe("choose_project");
  });
});

describe("use case 1: Kemar's update splits across projects (machine map story update-splits)", () => {
  it("replays the three steps", () => {
    const i1 = toProject("forager", "Kyle is the contact on #151"); // Atlas reads the Forager lines
    expect(i1).toMatchObject({ state: "routed", projectId: "forager" });
    const i2 = toProject("insights", "you said 'On Store Insights'"); // Atlas reads "On Store Insights..."
    expect(i2).toMatchObject({ state: "routed", projectId: "insights" });
    const { items } = save([i1, i2]); // 9:10am. Kemar checks both projects and saves
    expect(items.map((i) => i.filedInto)).toEqual(["forager", "insights"]);
    expect(visibleItems(ALICIA, items, WORLD).map((i) => i.ordinal)).toEqual([0]);
    expect(visibleItems(ANDRE, items, WORLD).map((i) => i.ordinal)).toEqual([1]);
    expect(visibleItems(BOB, items, WORLD)).toEqual([]);
    expect(mayReadCapture({ personId: "kemar" }, { authorId: "kemar" })).toBe(true);
  });
});

// Property test: random runs of the Routing model's moves against the real code, holding its properties.
describe("routing keeps the model-checked properties", () => {
  const ITEMS = 2;
  const item = fc.integer({ min: 0, max: ITEMS - 1 });
  const step = fc.oneof(
    fc.record({
      kind: fc.constant("atlas" as const),
      i: item,
      guess: fc.oneof(
        fc.constantFrom(...NAMES).map((projectId): AtlasGuess => ({ kind: "project", projectId, reason: "Atlas" })),
        fc.subarray(NAMES).map((projectIds): AtlasGuess => ({ kind: "ambiguous", projectIds, reason: "Atlas" })),
        fc.constant<AtlasGuess>({ kind: "none" }),
      ),
    }),
    fc.record({ kind: fc.constant("author" as const), i: item, p: fc.constantFrom(...NAMES) }),
    fc.record({ kind: fc.constant("private" as const), i: item }),
    fc.record({ kind: fc.constant("leave" as const), p: fc.constantFrom("forager", "insights") }),
    fc.record({ kind: fc.constant("disconnect" as const), p: fc.constantFrom("forager", "insights") }),
    fc.record({ kind: fc.constant("save" as const) }),
  );

  it("RoutedOnlyToCandidates, OnlyMemberProjects, NothingFiledWhileChoosing, NoCrossProjectQuote, NoCrossOrg", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        let world = WORLD;
        let routes: (Route | null)[] = Array(ITEMS).fill(null);
        let items: SavedItem[] | null = null;
        for (const s of steps) {
          const before = { world, routes };
          const reviewing = items === null;
          if (s.kind === "atlas" && reviewing && routes[s.i] === null) {
            routes = routes.map((r, i) => (i === s.i ? routeFromAtlas(s.guess, KEMAR, world) : r));
          } else if ((s.kind === "author" || s.kind === "private") && reviewing && routes[s.i] !== null) {
            const route = routes[s.i] as Route;
            const event = s.kind === "author" ? intoProject(route, s.p) : ({ type: "KEEP_PRIVATE" } as const);
            routes = routes.map((r, i) => (i === s.i ? applyRouting(route, event, KEMAR, world).route : r));
          } else if (s.kind === "leave") {
            world = without(world, "kemar", s.p);
          } else if (s.kind === "disconnect") {
            world = disconnected(world, s.p);
          } else if (s.kind === "save" && reviewing && routes.every((r) => r !== null)) {
            const plan = planRoutingAtSave((routes as Route[]).map((route, ordinal) => ({ ordinal, route })), KEMAR, world);
            if (plan.ok) {
              items = routes.map((_, ordinal) => ({
                ordinal,
                authorId: "kemar",
                filedInto: plan.filed.find((f) => f.ordinal === ordinal)?.projectId ?? null,
                spans: [{ start: ordinal * 10, end: ordinal * 10 + 9 }],
              }));
              // OnlyMemberProjects: at the moment of saving, every filed item goes to a candidate
              for (const f of plan.filed) expect(isCandidate("kemar", KEMAR.orgTags, f.projectId, before.world), "OnlyMemberProjects").toBe(true);
              // NothingFiledWhileChoosing
              expect(routes.some((r) => r?.state === "choose_project"), "NothingFiledWhileChoosing").toBe(false);
            }
          }
          // RoutedOnlyToCandidates: an item is only ever routed to a project Kemar can file into right now
          routes.forEach((r, i) => {
            const old = before.routes[i];
            const moved = r !== old && r?.state === "routed" && r.projectId !== null;
            if (moved) expect(isCandidate("kemar", KEMAR.orgTags, r.projectId as string, before.world), "RoutedOnlyToCandidates").toBe(true);
          });
          if (items) {
            for (const reader of READERS) {
              for (const seen of visibleItems(reader, items, world)) {
                if (seen.filedInto === null) {
                  expect(reader.personId, "NoCrossProjectQuote: only the author sees an unfiled item").toBe("kemar");
                  continue;
                }
                const project = PROJECTS.find((p) => p.id === seen.filedInto);
                // NoCrossProjectQuote
                expect(world.memberships.some((x) => x.personId === reader.personId && x.projectId === seen.filedInto && x.state === "member"), "NoCrossProjectQuote").toBe(true);
                // NoCrossOrg
                expect(project?.orgTag, "NoCrossOrg").toBe(reader.orgTag);
              }
            }
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});
