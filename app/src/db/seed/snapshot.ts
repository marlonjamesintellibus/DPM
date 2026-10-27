// The 20 Oct 2026 snapshot (KB Part B, use case 1), before Kemar saves his update.
// Every name is a placeholder. Ids match the domain fixture (src/domain/atlas-checks/kemar-note.fixture.ts)
// and a test keeps the two in step. Times are UTC; Jamaica is UTC-5 all year.

export const SNAPSHOT = {
  today: "2026-10-20",
  /** 9:10am in Jamaica: the moment the screens show. */
  now: "2026-10-20T14:10:00Z",
} as const;

export const ORG = { id: "intellibus", name: "Intellibus", timeZone: "America/Jamaica" };

export const PEOPLE = [
  { id: "kemar", name: "Kemar Brown", initials: "KB", title: "Data engineer", orgRole: "employee" as const },
  { id: "alicia", name: "Alicia Campbell", initials: "AC", title: "Delivery lead", orgRole: "delivery_lead" as const },
  { id: "andre", name: "Andre Mitchell", initials: "AM", title: "PM, Store Insights", orgRole: "delivery_lead" as const },
  { id: "jodian", name: "Jodian Taylor", initials: "JT", title: "Intern", orgRole: "employee" as const },
  { id: "kyle", name: "Kyle", initials: "K", title: "Sprouts IT", orgRole: null },
];

// Kemar's 5 groups (use case 1). Only the three project groups are connected to DPM.
export const GROUPS = [
  { id: "g-forager", name: "Forager 2.0", kind: "project" as const, ownerId: "alicia", connectedToDpm: true, members: ["alicia", "kemar", "jodian"] },
  { id: "g-insights", name: "Sprouts Store Insights", kind: "project" as const, ownerId: "andre", connectedToDpm: true, members: ["andre", "kemar"] },
  { id: "g-gq", name: "GQ & Academy", kind: "project" as const, ownerId: "alicia", connectedToDpm: true, members: ["alicia", "kemar"] },
  { id: "g-data-guild", name: "Data guild", kind: "team" as const, ownerId: "alicia", connectedToDpm: false, members: ["kemar", "jodian"] },
  { id: "g-uwi-study", name: "UWI Mona study group", kind: "personal" as const, ownerId: "kemar", connectedToDpm: false, members: ["kemar"] },
];

export const PROJECTS = [
  {
    id: "forager",
    groupId: "g-forager",
    name: "Forager 2.0",
    aliases: ["Forager"],
    customer: "Sprouts",
    ownerId: "alicia",
    contractType: "fixed_price" as const,
    startDate: "2026-10-12",
    endDate: "2026-11-06",
  },
  {
    id: "insights",
    groupId: "g-insights",
    name: "Store Insights",
    aliases: ["Sprouts Store Insights"],
    customer: "Sprouts",
    ownerId: "andre",
    contractType: "time_and_material" as const,
    startDate: "2026-10-05",
    endDate: "2026-12-18",
  },
  { id: "gq", groupId: "g-gq", name: "GQ & Academy", aliases: ["GQ", "Academy"], customer: null, ownerId: "alicia", contractType: "internal" as const, startDate: null, endDate: null },
];

export const MEMBERSHIPS = [
  { projectId: "forager", personId: "alicia", role: "pm" as const },
  { projectId: "forager", personId: "kemar", role: "member" as const },
  { projectId: "forager", personId: "jodian", role: "member" as const },
  { projectId: "insights", personId: "andre", role: "pm" as const },
  { projectId: "insights", personId: "kemar", role: "member" as const },
  { projectId: "gq", personId: "alicia", role: "pm" as const },
  { projectId: "gq", personId: "kemar", role: "member" as const },
];

export const CONTACTS = [{ projectId: "forager", personId: "kyle", tie: "contact on #151 (Sprouts IT)" }];

// Forager 2.0 (KB B5): three threads, five milestones, a handful of the #142 to #163 issues
export const THREADS = [
  { id: "th-trend", projectId: "forager", name: "Trend to buyer email", description: "TikTok to model to weekly buyer email", position: 1 },
  { id: "th-store", projectId: "forager", name: "Store sales signal", description: "Store feed to model to dashboard tile", position: 2 },
  { id: "th-prod", projectId: "forager", name: "Production ready", description: "Checks, monitoring and rollout", position: 3 },
  { id: "th-weekly", projectId: "insights", name: "Weekly reporting", description: "Sales export to the buyers' report", position: 1 },
];

export const MILESTONES = [
  { id: "ms-data", projectId: "forager", threadId: "th-trend", name: "Data sources", ownerId: "kemar", state: "done" as const, targetDate: "2026-10-16", forecastDate: null, clientVisible: false },
  { id: "ms-trend", projectId: "forager", threadId: "th-trend", name: "Trend model", ownerId: "kemar", state: "in_progress" as const, targetDate: "2026-10-23", forecastDate: "2026-10-23", clientVisible: false },
  { id: "ms-release-1", projectId: "forager", threadId: "th-trend", name: "Buyer pilot · Release 1", ownerId: "alicia", state: "planned" as const, targetDate: "2026-10-30", forecastDate: "2026-10-30", clientVisible: true },
  { id: "ms-prod-checks", projectId: "forager", threadId: "th-prod", name: "Production checks", ownerId: "alicia", state: "planned" as const, targetDate: "2026-11-03", forecastDate: null, clientVisible: false },
  { id: "ms-release-2", projectId: "forager", threadId: "th-prod", name: "Rollout · Release 2", ownerId: "alicia", state: "planned" as const, targetDate: "2026-11-06", forecastDate: null, clientVisible: true },
];

export const WORK_ITEMS = [
  { id: "wi-142", projectId: "forager", threadId: "th-trend", milestoneId: "ms-data", number: "#142", title: "TikTok trend ingest", ownerId: "kemar", state: "done" as const, startDate: "2026-10-12", dueDate: "2026-10-19", linkedChange: "https://github.com/intellibus/forager/pull/142" },
  { id: "wi-145", projectId: "forager", threadId: "th-trend", milestoneId: "ms-data", number: "#145", title: "Google Trends connector", ownerId: "kemar", state: "in_progress" as const, startDate: "2026-10-14", dueDate: "2026-10-21" },
  { id: "wi-147", projectId: "forager", threadId: "th-trend", milestoneId: "ms-trend", number: "#147", title: "Trend scoring model", ownerId: "kemar", state: "in_progress" as const, startDate: "2026-10-19", dueDate: "2026-10-23" },
  { id: "wi-151", projectId: "forager", threadId: "th-store", milestoneId: null, number: "#151", title: "Store sales feed access", ownerId: "kemar", state: "in_progress" as const, startDate: "2026-10-15", dueDate: "2026-10-22" },
  { id: "wi-152", projectId: "forager", threadId: "th-store", milestoneId: null, number: "#152", title: "Store feed connector", ownerId: "kemar", state: "to_do" as const, startDate: "2026-10-21", dueDate: "2026-10-27" },
  { id: "wi-160", projectId: "forager", threadId: "th-prod", milestoneId: "ms-prod-checks", number: "#160", title: "Feature store backfill", ownerId: "jodian", state: "in_progress" as const, startDate: "2026-10-22", dueDate: "2026-10-28" },
  { id: "wi-208", projectId: "insights", threadId: "th-weekly", milestoneId: null, number: "#208", title: "Weekly sales export", ownerId: "kemar", state: "in_progress" as const, startDate: "2026-10-19", dueDate: "2026-10-23" },
];

// KB B4: "handover 2 of 4". The runbook is the step Kemar's note talks about.
export const HANDOVER = {
  id: "ho-kemar-jodian",
  projectId: "forager",
  fromPersonId: "kemar",
  toPersonId: "jodian",
  title: "Kemar to Jodian: pipeline cover for 26 to 30 Oct",
  state: "in_progress" as const,
  steps: [
    { id: "hs-access", title: "Access", state: "handed_over" as const },
    { id: "hs-monitoring", title: "Monitoring", state: "handed_over" as const },
    { id: "ho-runbook", title: "Runbook", state: "not_done" as const },
    { id: "hs-contacts", title: "Contacts", state: "not_done" as const },
  ],
};

export const LEAVE = [{ id: "lv-kemar-oct", personId: "kemar", startDate: "2026-10-26", endDate: "2026-10-30", state: "approved" as const }];

// Forager's BRAID log before Kemar saves (KB B5, L14b). Store Insights and GQ have none yet.
export const BRAID = [
  {
    id: "br-feed-blocker",
    projectId: "forager",
    kind: "blocker" as const,
    title: "Store sales feed access",
    state: "reported" as const,
    ownerId: "kemar", // owner of the blocked work (#151), who may resolve it (S13)
    reportedBy: "alicia",
    sources: [{ id: "src-feed-alicia", personId: "alicia", at: "2026-10-14T15:00:00Z" }],
  },
  {
    id: "br-feed-dependency",
    projectId: "forager",
    kind: "dependency" as const,
    title: "Store sales feed access from Sprouts IT",
    state: "open" as const,
    ownerId: "alicia",
    reportedBy: "alicia",
    decidedBy: "alicia",
    decidedOn: "2026-10-14",
    sources: [{ id: "src-dep-alicia", personId: "alicia", at: "2026-10-14T15:00:00Z" }],
  },
  {
    id: "br-pipeline-risk",
    projectId: "forager",
    kind: "risk" as const,
    title: "Only Kemar can run the pipeline",
    state: "mitigating" as const,
    ownerId: "alicia",
    reportedBy: "alicia",
    decidedBy: "alicia",
    decidedOn: "2026-10-15",
    sources: [{ id: "src-pipeline-alicia", personId: "alicia", at: "2026-10-15T16:00:00Z" }],
  },
  {
    id: "br-buyers-assumption",
    projectId: "forager",
    kind: "assumption" as const,
    title: "Buyers available for the pilot week of 26 Oct",
    state: "holding" as const,
    ownerId: "alicia",
    reportedBy: "alicia",
    decidedBy: "alicia",
    decidedOn: "2026-10-12",
    sources: [{ id: "src-buyers-alicia", personId: "alicia", at: "2026-10-12T15:00:00Z" }],
  },
  {
    id: "br-rate-limit",
    projectId: "forager",
    kind: "issue" as const,
    title: "Google Trends rate limit",
    state: "resolved" as const,
    ownerId: "kemar",
    reportedBy: "kemar",
    resolvedBy: "kemar",
    resolvedOn: "2026-10-17",
    sources: [
      { id: "src-rate-kemar", personId: "kemar", at: "2026-10-13T15:00:00Z" },
      { id: "src-rate-jodian", personId: "jodian", at: "2026-10-13T17:30:00Z" },
      { id: "src-rate-alicia", personId: "alicia", at: "2026-10-14T13:00:00Z" },
    ],
  },
];

export const BRAID_LINKS = [{ entryId: "br-feed-blocker", otherEntryId: "br-feed-dependency", relation: "related" as const }];

export const KEMAR_CAPTURE = {
  id: "cap-kemar-0858",
  authorId: "kemar",
  channel: "atlas" as const,
  /** The Atlas messaging app's id for the voice note (D14). */
  messageId: "atl-msg-0858",
  kind: "voice" as const,
  durationSeconds: 31,
  messageAt: "2026-10-20T13:58:00Z",
  receivedAt: "2026-10-20T13:58:20Z",
  transcriptConfidence: "high" as const,
};

/** 9:02am: after standup, Alicia sets Forager 2.0 Off track with no reason. */
export const ALICIA_SETS = { projectId: "forager", by: "alicia", at: "2026-10-20T14:02:00Z", status: "off_track" as const };
