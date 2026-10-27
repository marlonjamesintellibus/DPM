// Use case 1, story steps 1 and 2: Kemar's 8:58am note on Tuesday 20 Oct 2026 (America/Jamaica),
// the candidate data DPM reads for him, and what a good model returns for it. Ids are placeholders
// for the seed (phase 2); names are the story's (KB Part B).
import type { CheckContext, RawProposal } from "./types";

export const KEMAR_NOTE =
  "Finished the TikTok ingest yesterday and the Google Trends connector is done too. Still waiting on Kyle for the store feed, so I think the model slips a day. I'm out from Monday the 26th, and Jodian has the runbook already. On Store Insights, the weekly sales export is fixed, and Andre and I agreed to move the refresh to 6am.";

/** 8:58am in Jamaica (UTC-5 all year). */
export const KEMAR_NOTE_AT = new Date("2026-10-20T13:58:00Z");

export const KEMAR_CONTEXT: CheckContext = {
  text: KEMAR_NOTE,
  messageAt: KEMAR_NOTE_AT,
  transcriptConfidence: "high",
  author: { id: "kemar", name: "Kemar Brown" },
  // Data guild has no project and the UWI study group is not authorized, so neither is here (M13)
  projects: [
    {
      id: "forager",
      name: "Forager 2.0",
      aliases: ["Forager"],
      role: "member",
      records: [
        { type: "work_item", id: "wi-142", number: "#142", title: "TikTok trend ingest", ownerId: "kemar", values: { state: "done", blocked_note: null } },
        { type: "work_item", id: "wi-145", number: "#145", title: "Google Trends connector", ownerId: "kemar", values: { state: "in_progress", blocked_note: null } },
        { type: "work_item", id: "wi-151", number: "#151", title: "Store sales feed access", ownerId: "kemar", values: { state: "in_progress", blocked_note: null } },
        { type: "work_item", id: "wi-160", number: "#160", title: "Feature store backfill", ownerId: "jodian", values: { state: "in_progress", blocked_note: null } },
        { type: "milestone", id: "ms-trend", title: "Trend model", ownerId: "kemar", values: { forecast: "2026-10-23", target: "2026-10-23" } },
        { type: "milestone", id: "ms-release-1", title: "Buyer pilot · Release 1", ownerId: "alicia", values: { forecast: "2026-10-30", target: "2026-10-30" } },
        // A step of Kemar's handover to Jodian (2 of 4 steps done)
        { type: "handover", id: "ho-runbook", title: "Runbook", ownerId: "kemar", values: { state: "not_done" } },
      ],
      people: [
        { personId: "alicia", name: "Alicia Campbell", role: "pm", tie: "PM" },
        { personId: "kemar", name: "Kemar Brown", role: "member", tie: "data engineer" },
        { personId: "jodian", name: "Jodian Taylor", role: "member", tie: "takes Kemar's handover" },
        { personId: "kyle", name: "Kyle", role: null, tie: "contact on #151 (Sprouts IT)" },
      ],
      braid: [
        { id: "br-feed-blocker", kind: "blocker", title: "Store sales feed access", state: "reported" },
        { id: "br-feed-dependency", kind: "dependency", title: "Store sales feed access from Sprouts IT", state: "open" },
        { id: "br-pipeline-risk", kind: "risk", title: "Only Kemar can run the pipeline", state: "mitigating" },
      ],
    },
    {
      id: "insights",
      name: "Store Insights",
      aliases: ["Sprouts Store Insights"],
      role: "member",
      records: [
        { type: "work_item", id: "wi-208", number: "#208", title: "Weekly sales export", ownerId: "kemar", values: { state: "in_progress", blocked_note: null } },
      ],
      people: [
        { personId: "andre", name: "Andre Mitchell", role: "pm", tie: "PM" },
        { personId: "kemar", name: "Kemar Brown", role: "member", tie: "data engineer" },
      ],
      braid: [],
    },
    {
      id: "gq",
      name: "GQ & Academy",
      aliases: ["GQ", "Academy"],
      role: "member",
      records: [],
      people: [
        { personId: "alicia", name: "Alicia Campbell", role: "pm", tie: "PM" },
        { personId: "kemar", name: "Kemar Brown", role: "member", tie: "member" },
      ],
      braid: [],
    },
  ],
  notConnected: [],
  leave: { targetId: "leave-kemar", approved: [{ id: "lv-kemar-oct", start: "2026-10-26", end: "2026-10-30" }] },
};

/** What a good model returns, in the order of the use case table (items 1 to 11). */
export const KEMAR_PROPOSALS: RawProposal[] = [
  {
    kind: "update",
    projectId: "forager",
    routingReason: { basis: "target", evidence: "#142", label: "#142" },
    targetId: "wi-142",
    field: "state",
    newValue: "done",
    quote: "Finished the TikTok ingest yesterday",
    confidence: "high",
    rationale: "Kemar finished the TikTok ingest",
  },
  {
    kind: "update",
    projectId: "forager",
    routingReason: { basis: "target", evidence: "#145", label: "#145" },
    targetId: "wi-145",
    field: "state",
    newValue: "done",
    quote: "the Google Trends connector is done too",
    confidence: "high",
    rationale: "The Google Trends connector is done",
  },
  {
    kind: "update",
    projectId: "forager",
    routingReason: { basis: "tied_person", evidence: "Kyle", label: "Kyle is the contact on #151" },
    targetId: "wi-151",
    field: "state",
    newValue: "blocked",
    note: "waiting on Kyle (Sprouts IT)",
    quote: "Still waiting on Kyle for the store feed",
    confidence: "high",
    rationale: "Blocked: waiting on Kyle (Sprouts IT)",
  },
  {
    kind: "update",
    projectId: "forager",
    routingReason: { basis: "owned_record", evidence: "Trend model", label: "Kemar owns it" },
    targetId: "ms-trend",
    field: "forecast",
    newValue: "2026-10-24",
    quote: "so I think the model slips a day",
    confidence: "medium",
    rationale: "The trend model forecast moves one day",
  },
  {
    kind: "update",
    projectId: null,
    routingReason: { basis: "personal", evidence: "I'm out", label: "Personal" },
    targetId: "leave-kemar",
    field: "dates",
    newValue: "2026-10-26/2026-10-30",
    quote: "I'm out from Monday the 26th",
    confidence: "high",
    rationale: "Kemar is on leave from Monday 26 Oct",
  },
  {
    kind: "update",
    projectId: "forager",
    routingReason: { basis: "owned_record", evidence: "Runbook", label: "His handover" },
    targetId: "ho-runbook",
    field: "state",
    newValue: "handed_over",
    quote: "Jodian has the runbook already",
    confidence: "low",
    rationale: "The runbook step of Kemar's handover is with Jodian",
  },
  {
    kind: "braid_same",
    projectId: "forager",
    routingReason: { basis: "target", evidence: "Store sales feed access", label: "Same subject as #151" },
    braidKind: "blocker",
    matchEntryId: "br-feed-blocker",
    quote: "Still waiting on Kyle for the store feed",
    confidence: "high",
    rationale: "Kemar is blocked by the same store feed: add him as a source",
  },
  {
    kind: "braid_new",
    projectId: "forager",
    routingReason: { basis: "same_quote", evidence: "so I think the model slips a day", label: "Same quote as #4" },
    braidKind: "risk",
    braidTitle: "Trend model may slip to 24 Oct",
    quote: "so I think the model slips a day",
    confidence: "medium",
    rationale: "A possible one-day slip on the trend model, for the PM to consider",
  },
  {
    kind: "braid_same",
    projectId: "forager",
    routingReason: { basis: "target", evidence: "Only Kemar can run the pipeline", label: "Same subject as #5 and #6" },
    braidKind: "risk",
    matchEntryId: "br-pipeline-risk",
    quote: "Jodian has the runbook already",
    confidence: "medium",
    rationale: "Evidence: the runbook is handed to Jodian",
  },
  {
    kind: "update",
    projectId: "insights",
    routingReason: { basis: "reference", evidence: "Store Insights", label: "\"On Store Insights\"" },
    targetId: "wi-208",
    field: "state",
    newValue: "done",
    quote: "On Store Insights, the weekly sales export is fixed",
    confidence: "high",
    rationale: "The weekly sales export is fixed",
  },
  {
    kind: "braid_new",
    projectId: "insights",
    routingReason: { basis: "reference", evidence: "Store Insights", label: "\"On Store Insights\"" },
    braidKind: "decision",
    braidTitle: "Move the daily refresh to 6am",
    quote: "Andre and I agreed to move the refresh to 6am",
    confidence: "high",
    rationale: "Kemar and Andre agreed this; it goes to the decider as a proposal",
  },
];
