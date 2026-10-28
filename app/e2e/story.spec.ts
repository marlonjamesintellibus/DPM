// Use case 1 in a real browser (use-cases/01-update-to-plan.md, "The story", steps 1 to 8), then the
// kind switch of section 13. The world is the seeded 20 Oct snapshot: Kemar's 8:58 voice note has
// arrived and Atlas has proposed its 11 items (steps 1 and 2); Alicia set Off track at 9:02 (step 3).
// Each step acts as one person through the screens, switching with View as, as the prototype does.
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;

async function viewAs(who: "kemar" | "alicia" | "andre", path = "/") {
  const url = new URL(path, test.info().project.use.baseURL);
  await page.context().addCookies([{ name: "dpm-viewer", value: who, url: url.origin }]);
  await page.goto(path);
}
const card = (text: string) => page.locator("article").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test("1, 2. Kemar's voice note: Atlas proposes 9 updates for 2 projects, 4 need his OK", async () => {
  await viewAs("kemar");
  await expect(page.getByText("Got it. 9 updates for 2 projects, and 4 need your OK.")).toBeVisible();
  await expect(page.getByText("Forager 2.0 · 7 updates · 4 need your OK")).toBeVisible();
  await expect(page.getByText("Store Insights · 2 updates")).toBeVisible();

  await page.getByRole("button", { name: "Review 4" }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect(page.getByText("9 updates for 2 projects").first()).toBeVisible();
  // Each card says why it went to that project; "the store feed" goes to Forager because Kyle is #151's contact
  await expect(card("Issue #151 Store sales feed access")).toContainText("Kyle is the contact on #151");
  await expect(card("Move the daily refresh to 6am")).toContainText('"On Store Insights"');
  await expect(card("Leave Kemar Brown")).toContainText("Matches approved leave");
  // Nothing is saved until he confirms: Save waits for the 4 that need his OK
  await expect(page.getByText("4 need your OK before this is saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 9 updates" })).toBeDisabled();
});

test("W3-D12. A new chat's welcome names the lead questions to Alicia, a PM, and not to Kemar", async () => {
  await viewAs("alicia", "/?view=chat&c=new");
  await expect(page.getByText(/what a teammate is working on/)).toBeVisible();
  await expect(page.getByText(/As a lead, you can also ask who hasn’t updated today/)).toBeVisible();
  await viewAs("kemar", "/?view=chat&c=new");
  await expect(page.getByText(/what a teammate is working on/)).toBeVisible();
  await expect(page.getByText(/As a lead/)).toHaveCount(0);
});

test("Section 15. Kemar asks Atlas what needs him: the answer links his waiting review", async () => {
  await viewAs("kemar", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await expect(box).toBeFocused();
  await box.fill("What needs me to review it today?");
  await box.press("Enter");
  // Section 17: the message shows at once, and never as "Reading your update"
  await expect(page.getByText("What needs me to review it today?", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Reading your update")).toHaveCount(0);
  await expect(page.getByText("Your update from 8:58am has 4 items waiting for your OK before it can be saved.")).toBeVisible();
  await expect(page.getByText("Got it. Nothing in this one changes a project.")).toHaveCount(0);
  // The answer lists each item, with Open and Accept
  await expect(page.getByRole("link", { name: /Milestone Trend model/ })).toHaveAttribute("href", "/review/cap-kemar-0858");
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(4);
  // A suggested follow-up is sent into the same conversation
  await page.getByRole("button", { name: "What's blocked?" }).click();
  await expect(page.getByText("1 thing is blocked on your projects.")).toBeVisible();
  // Ask Atlas started a new conversation, titled from the question (section 16)
  await expect(page).toHaveURL(/c=conv-/);
  await expect(page.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: /What needs me to review it today\?/ })).toBeVisible();
});

test("Section 16. Conversations: a follow-up continues one, New starts another, and one is archived", async () => {
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What's blocked on Forager?");
  await box.press("Enter");
  await expect(page.getByText("1 thing is blocked on Forager 2.0.")).toBeVisible();
  // A follow-up is read with the question before it
  await box.fill("and on Store Insights?");
  await box.press("Enter");
  await expect(page.getByText("Nothing is blocked on Store Insights.")).toBeVisible();
  const list = page.getByRole("navigation", { name: "Conversations" });
  const rows = list.locator('a[href*="c=conv-"]:visible');
  await expect(rows).toHaveCount(2); // the Atlas app's conversation and this one

  await page.getByRole("link", { name: "New", exact: true }).click();
  await expect(page.getByText("You can also ask me what needs you")).toBeVisible();
  await box.fill("and on that one?");
  await box.press("Enter");
  await expect(page.getByText("I'm not sure what you mean. Ask the whole question")).toBeVisible();
  await expect(rows).toHaveCount(3);

  await page.getByRole("button", { name: "More for and on that one?" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(rows).toHaveCount(2);
  await expect(list.getByText("Archived (1)")).toBeVisible();
});

test("Section 18. Kemar asks what he is working on: his open work, each linked to its project", async () => {
  await page.getByRole("link", { name: "New", exact: true }).click();
  await expect(page.getByText("what you’re working on, what’s due, what you promised, any updates, who mentioned you")).toBeVisible();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What am I working on?");
  await box.press("Enter");
  await expect(page.getByText("You have 5 open work items, 1 milestone and 1 entry on the BRAID log.")).toBeVisible();
  await expect(page.getByRole("link", { name: /#145 Google Trends connector/ })).toHaveAttribute("href", "/projects/forager");
  await expect(page.getByRole("link", { name: /#208 Weekly sales export/ })).toHaveAttribute("href", "/projects/insights");
  await expect(page.getByRole("link", { name: /^Store sales feed access/ })).toHaveAttribute("href", "/projects/forager?view=table&log=blocker");
  // Its suggested follow-ups lead on to what is due
  await expect(page.getByRole("button", { name: "What's due this week?" })).toBeVisible();
});

test("Phase Q. Kemar asks what GQ is and where to start: who owns it, its empty plan, and who to ask (EX2)", async () => {
  await page.getByRole("link", { name: "New", exact: true }).click();
  // The new conversation's welcome first, so the question goes to it and not to the one being left
  await expect(page.getByText("You can also ask me what needs you")).toBeVisible();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("I'm new on GQ, where do I start?");
  await box.press("Enter");
  await expect(page.getByText(/^GQ & Academy is an internal project, with no dates set yet, and Alicia Campbell owns it\./)).toBeVisible();
  await expect(page.getByText(/It has no threads or milestones yet\. They come from GitHub and from updates people give Atlas\./)).toBeVisible();
  await expect(page.getByText(/Where to start: nothing on it is yours yet, so ask Alicia where to begin\.$/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Internal, with no dates set yet/ })).toHaveAttribute("href", "/projects/gq");
});

test("3. Alicia set Forager 2.0 Off track at 9:02 with no reason", async () => {
  await viewAs("alicia");
  await expect(page.getByRole("link", { name: /Forager 2.0 is set Off track, but the plan says/ }).first()).toBeVisible();
});

test("4. Kemar accepts #4, #8 and #9, edits #6 and saves: 9 changes for 2 projects", async () => {
  await viewAs("kemar", "/review/cap-kemar-0858");
  for (const text of ["Milestone Trend model", "Trend model may slip to 26 Oct", "Only Kemar can run the pipeline"]) {
    await card(text).getByRole("button", { name: "Accept" }).click();
    await expect(card(text).getByRole("button", { name: "Undo" })).toBeVisible();
  }
  const runbook = card("Handover Runbook");
  await runbook.getByRole("button", { name: "Change" }).click();
  await runbook.getByLabel("New value").selectOption({ label: "Handed over" });
  await runbook.getByRole("button", { name: "Save change" }).click();
  await expect(runbook.getByRole("button", { name: "Undo" })).toBeVisible();

  const save = page.getByRole("button", { name: "Save 9 updates" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();
});

test("5. The rules run: Forager is calculated At risk, the blocker has 2 reports, a risk waits for Alicia", async () => {
  await viewAs("alicia", "/projects/forager?view=table");
  const blocker = page.locator("details").filter({ hasText: "Store sales feed access" }).filter({ hasText: "Blocker" }).first();
  await expect(blocker.locator("summary")).toContainText("2");
  await expect(page.locator("details").filter({ hasText: "Trend model may slip to 26 Oct" }).locator("summary")).toContainText("Waiting for PM or Lead");
  await page.goto("/projects/forager");
  await expect(page.locator("section").filter({ hasText: "Plan" }).first()).toContainText("At risk");
});

test("6. Alicia approves Kemar's risk from her chat answer in one tap (phase B), then saves the reason linked to the blocker and the risk", async () => {
  await viewAs("alicia", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What needs me today?");
  await box.press("Enter");
  // The line carries the inbox's own buttons; Approve runs the same command, confirmed in the same tap
  const line = page.getByRole("listitem").filter({ hasText: "Kemar raised a risk: Trend model may slip to 26 Oct" });
  await expect(line.getByRole("button", { name: "Decline" })).toBeVisible();
  await line.getByRole("button", { name: "Approve" }).click();
  await expect(line.getByText("Approved.")).toBeVisible();

  // The inbox item closed, as if she had approved it there
  await page.goto("/?view=inbox");
  await expect(page.getByRole("link", { name: "Forager 2.0 is set Off track, but the plan says At risk" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Kemar raised a risk/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Forager 2.0 is set Off track, but the plan says At risk" }).first().click();
  await expect(page.getByLabel("Reason")).not.toBeEmpty();
  for (const chip of ["Blocker · Store sales feed access", "Risk · Trend model may slip to 26 Oct"]) {
    const button = page.getByRole("button", { name: new RegExp(`^${chip}`) }).first();
    if ((await button.getAttribute("aria-pressed")) === "false") await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});

test("7. Andre approves Kemar's decision in the inbox; it is on the Store Insights log with Andre as approver", async () => {
  // Phase B first: in the chat the line carries the inbox's buttons, and a typed command makes one
  // confirm card; cancelling it changes nothing
  await viewAs("andre", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What needs me today?");
  await box.press("Enter");
  const line = page.getByRole("listitem").filter({ hasText: "Kemar proposed a decision: move the daily refresh to 6am" });
  await expect(line.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(line.getByRole("button", { name: "Decline" })).toBeVisible();
  await box.fill("Approve the refresh decision");
  await box.press("Enter");
  const confirm = page.getByRole("group", { name: 'Approve decision "Move the daily refresh to 6am" on Store Insights?' });
  await expect(confirm.getByRole("button", { name: "Approve" })).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm.getByText("Cancelled. Nothing changed.")).toBeVisible();

  // The inbox's own Approve, as before the chat could act
  await page.goto("/?view=inbox");
  await page.getByRole("link", { name: /Kemar proposed a decision: move the daily refresh to 6am/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("link", { name: /Kemar proposed a decision/ })).toHaveCount(0);
  await page.goto("/projects/insights?view=table");
  const decision = page.locator("details").filter({ hasText: "Move the daily refresh to 6am" });
  await expect(decision.locator("summary")).toContainText("Approved");
  await decision.locator("summary").click();
  await expect(decision).toContainText("Andre and I agreed to move the refresh to 6am");
});

test("Phase C. Alicia asks why Forager is Off track; Kemar asks when the refresh was decided", async () => {
  await viewAs("alicia", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Why is Forager off track?");
  await box.press("Enter");
  // Her set status, with the reason she saved in step 6 and the entries it links
  await expect(page.getByText(/Forager 2\.0 is Off track: Alicia set it on .+, with the reason/)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Store sales feed access/ }).first()).toHaveAttribute("href", "/projects/forager?view=table&log=blocker");

  await viewAs("kemar", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  await box.fill("When did we decide to move the refresh?");
  await box.press("Enter");
  await expect(page.getByText(/Andre approved "Move the daily refresh to 6am" on Store Insights/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Move the daily refresh to 6am/ })).toHaveAttribute("href", "/projects/insights?view=table&log=decision");
});

test("Phase G. Kemar drafts his standup from what he saved and copies it; a client status is the PM's, and holds only what the client view shows", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Draft my standup");
  await box.press("Enter");
  // "since yesterday", or since the last working day when the story runs on a Monday
  await expect(page.getByText(/^Here's a draft of your standup, from what you saved since .+ and your open work\. Edit it, then copy it\.$/)).toBeVisible();
  // No model on the fixture: DPM's plain list of the facts (DR6), his saved changes told as review tells them, never his words (CD8)
  const standup = page.getByRole("textbox", { name: "Your standup" });
  await expect(standup).toHaveValue(/#145 Google Trends connector: In progress to Done/);
  await expect(standup).not.toHaveValue(/waiting on Kyle/);
  await expect(page.getByText("· the facts as a plain list")).toBeVisible();
  await standup.fill("Yesterday I finished #145 Google Trends connector.");
  await page.getByRole("group", { name: "Draft standup" }).getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied. Paste it where you need it.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your standup" })).toHaveCount(0);

  // DR3: a member gets no client status
  await box.fill("Draft a client status for Forager");
  await box.press("Enter");
  await expect(page.getByText("Only a PM or Lead of Forager 2.0 can draft a client status.")).toBeVisible();

  // Alicia gets one: the releases only, until she shares the status and its reason with the client (DR4)
  await viewAs("alicia", "/?view=chat&c=new&ask=1");
  await box.fill("Draft a client status for Forager");
  await box.press("Enter");
  const client = page.getByRole("textbox", { name: "Your client status" });
  await expect(client).toHaveValue(/Buyer pilot · Release 1: planned Fri 30 Oct/);
  await expect(client).not.toHaveValue(/Trend model|Off track|#151/);
  await page.getByRole("group", { name: "Draft client status for Forager 2.0" }).getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Discarded. Nothing was sent.")).toBeVisible();
  await viewAs("kemar", "/projects/forager");
  await expect(page.getByRole("button", { name: "Share status with client" })).toHaveCount(0); // only the PM shares it
  await viewAs("alicia", "/projects/forager");
  await page.getByRole("button", { name: "Share status with client" }).click();
  await expect(page.getByText("Status shared with the client")).toBeVisible();
  await viewAs("alicia", "/?view=chat&c=new&ask=1");
  await box.fill("Draft a client status for Forager");
  await box.press("Enter");
  await expect(page.getByRole("textbox", { name: "Your client status" })).toHaveValue(/Status:\n- Off track: /);
});

test("Phase H. Alicia asks what Kemar is working on and who owns the store feed; Andre asks about Jodian, whom he shares no project with", async () => {
  await viewAs("alicia", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What is Kemar working on?");
  await box.press("Enter");
  // Only what they share (CD9): his Forager work, never his Store Insights export
  await expect(page.getByText(/^Kemar Brown has \d+ open work items?.* on projects you share; /)).toBeVisible();
  await expect(page.getByRole("link", { name: /#152 Store feed connector/ })).toHaveAttribute("href", "/projects/forager");
  await expect(page.getByRole("link", { name: /#208 Weekly sales export/ })).toHaveCount(0);
  await box.fill("Who owns the store feed?");
  await box.press("Enter");
  await expect(page.getByText("Kemar Brown owns #152 Store feed connector on Forager 2.0.")).toBeVisible();
  // CV8: a follow-up asks the owner of what it names, never the store feed again
  await box.fill("and the trend model?");
  await box.press("Enter");
  await expect(page.getByText("Kemar Brown owns Trend model on Forager 2.0.")).toBeVisible();

  // PP1: the same words as for a name nobody has
  await viewAs("andre", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  await box.fill("What is Jodian working on?");
  await box.press("Enter");
  await expect(page.getByText("I can't tell you about them. Ask about someone you share a project with, by their name.")).toBeVisible();
});

test("Phase N. Alicia asks who hasn't updated and who can pick up #160; Kemar, a member, is told only PMs and Leads can see it", async () => {
  await viewAs("alicia", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Who hasn't updated today?");
  await box.press("Enter");
  // Names only, per project she leads; Kemar saved his 8:58 note about Forager in step 4 (LD9)
  await expect(page.getByText(/no update saved today on Forager 2\.0: Jodian Taylor\./)).toBeVisible();
  await box.fill("Who can pick up #160?");
  await box.press("Enter");
  await expect(page.getByText(/^#160 Feature store backfill on Forager 2\.0 is Jodian Taylor's\./)).toBeVisible();
  await expect(page.getByRole("link", { name: /Kemar Brown/ }).last()).toHaveAttribute("href", "/projects/forager");

  // LD1: nothing about anyone
  await viewAs("kemar", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  await box.fill("Who hasn't updated today?");
  await box.press("Enter");
  await expect(page.getByText("Only PMs and Leads can see that.")).toBeVisible();
});

test("8. Each person sees only their part of Kemar's note", async () => {
  // Alicia sees the Forager quotes, never the Store Insights sentence
  await viewAs("alicia", "/projects/forager?view=table");
  const blocker = page.locator("details").filter({ hasText: "Store sales feed access" }).filter({ hasText: "Blocker" }).first();
  await blocker.locator("summary").click();
  await expect(blocker).toContainText("Still waiting on Kyle for the store feed");
  await expect(page.getByText("On Store Insights")).toHaveCount(0);
  await page.goto("/review/cap-kemar-0858");
  await expect(page.getByRole("heading", { name: "Not found, or not yours to see" })).toBeVisible();
  await expect(page.getByText("Finished the TikTok ingest yesterday")).toHaveCount(0);

  // Andre sees only the Store Insights sentence, and nothing of Forager
  await viewAs("andre", "/projects/insights?view=table");
  await expect(page.getByText("Kyle")).toHaveCount(0);
  // A project that is not his reads exactly like one that does not exist (P10)
  await page.goto("/projects/forager");
  await expect(page.getByRole("heading", { name: "Not found, or not yours to see" })).toBeVisible();
  await expect(page.getByText("Store sales feed access")).toHaveCount(0);

  // Only Kemar sees the whole note
  await viewAs("kemar", "/review/cap-kemar-0858");
  await expect(page.getByText("Finished the TikTok ingest yesterday", { exact: true })).toBeVisible();
  await expect(page.getByText("Andre and I agreed to move the refresh to 6am", { exact: true })).toBeVisible();
});

test("Phase L. Kemar's Undo is refused: Alicia and Andre acted on his save since, and nothing is undone (UN2)", async () => {
  await viewAs("kemar", "/?view=chat&c=conv-atlas-kemar");
  // The saved message carries Undo while undoMinutes have not passed
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Someone changed these since you saved it, so nothing was undone.").first()).toBeVisible();
  // "Undo that" says the same, naming each record and who changed it; the save was undone at most once (UN5)
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Undo that");
  await box.press("Enter");
  await expect(page.getByRole("link", { name: /Trend model may slip to 26 Oct/ })).toContainText("Alicia changed it at");
  await expect(page.getByRole("link", { name: /Move the daily refresh to 6am/ })).toContainText("Andre changed it at");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  await page.goto("/projects/forager?view=table");
  await expect(page.locator("details").filter({ hasText: "Trend model may slip to 26 Oct" }).locator("summary")).toContainText("Open");
});

test("Phase L. Kemar asks why Atlas filed his update: each part, the reason and his words", async () => {
  await viewAs("kemar", "/?view=chat&c=conv-atlas-kemar");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Why did you file that?");
  await box.press("Enter");
  await expect(page.getByText("Here's where each part of your 8:58am update went, and why.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Issue #151 Store sales feed access/ })).toContainText("Filed in Forager 2.0 because: Kyle is the contact on #151");
});

test("Section 13. Alicia makes the pipeline risk an issue; the log keeps one row", async () => {
  await viewAs("alicia", "/projects/forager?view=table");
  await page.locator("details").filter({ hasText: "Only Kemar can run the pipeline" }).getByRole("button", { name: "Risk: change kind" }).click();
  const menu = page.getByRole("dialog", { name: "Change kind" });
  await menu.getByRole("radio", { name: /Issue/ }).click();
  await menu.getByRole("textbox").fill("Kemar is on leave next week and nobody else has run it");
  await menu.getByRole("button", { name: "Switch to Issue" }).click();
  const row = page.locator("details").filter({ hasText: "Only Kemar can run the pipeline" });
  await expect(row).toHaveCount(1);
  await expect(row.locator("summary")).toContainText("Was a risk");
  await expect(row.locator("summary")).toContainText("Alicia switched this from Risk to Issue");
});

test("P11. Empty sections stay and say why; a wrong address says so", async () => {
  await viewAs("alicia", "/projects/gq");
  await expect(page.getByText("No work or milestones on this plan yet.")).toBeVisible();
  await expect(page.getByText("No milestones on this project yet, so there is nothing to forecast.")).toBeVisible();
  await expect(page.getByText("None on the log").first()).toBeVisible();
  await page.goto("/projects/gq?view=table");
  await expect(page.getByText("Nothing on this log yet.")).toBeVisible();
  await page.goto("/projects/forager?view=table&log=decision");
  await expect(page.getByText("No decisions on this log.")).toBeVisible();
  await page.goto("/projects/no-such-project");
  await expect(page.getByRole("heading", { name: "Not found, or not yours to see" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Phase B. Kemar marks his own work done from an answer line, in one tap", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What am I working on?");
  await box.press("Enter");
  const line = page.getByRole("listitem").filter({ hasText: "#152 Store feed connector" });
  await line.getByRole("button", { name: "Mark done" }).click();
  await expect(line.getByText("Marked done.")).toBeVisible();
  // A fresh answer no longer lists it; the first answer stays as it was given
  await box.fill("What am I working on?");
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: /#152 Store feed connector/ })).toHaveCount(1);
});

test("Phase D. Kemar's vague update gets one question; he taps #152 and the review shows his choice", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Worked on the store feed today.");
  await box.press("Enter");
  // The recorded read fits #151 and #152, so Atlas asks which, with both as buttons (M21)
  await expect(page.getByText('For "Worked on the store feed today", do you mean #151 Store sales feed access or #152 Store feed connector?')).toBeVisible();
  const options = page.getByRole("group", { name: "Choose one" });
  await expect(options.getByRole("button")).toHaveCount(2);
  await options.getByRole("button", { name: "#152 Store feed connector" }).click();
  await expect(page.getByText("Got it: #152 Store feed connector. It's in your review, waiting for your OK.").first()).toBeVisible();
  // Answering only chose: the update still waits for his OK in the review, which shows where he chose it
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect(card("Issue #152 Store feed connector")).toContainText("You chose this one in the chat");
  await expect(card("Issue #152 Store feed connector").getByRole("button", { name: "Save" })).toBeVisible();
});

test("Phase D. A typed answer is read against the options only (CL2)", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Worked on the store feed today.");
  await box.press("Enter");
  await expect(page.getByRole("group", { name: "Choose one" })).toBeVisible();
  await box.fill("the sales feed access one");
  await box.press("Enter");
  await expect(page.getByText("Got it: #151 Store sales feed access. It's in your review, waiting for your OK.").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Choose one" })).toHaveCount(0);
});

test("Phase J. Kemar's standup asks from all his open work, blocked first; Done on his work In progress becomes an update he reviews", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  await page.getByRole("button", { name: "Start my standup" }).click();
  await expect(page.getByText("Let's do your standup. Tap an answer or type your own. Skip moves on, and That's all ends it.")).toBeVisible();
  // His 8:58 note blocked #151 on Kyle; a standup he starts asks about it all the same (CD12), blocked work first (M28)
  await expect(page.getByText(/^#151 Store sales feed access is Blocked/)).toBeVisible();
  await page.getByRole("group", { name: "Your answer" }).getByRole("button", { name: "Still stuck", exact: true }).click();
  // Then his work In progress, soonest due first; #145 is done and #152 was marked done from an answer
  const asked = page.getByText(/is In progress\. Done, still going, or stuck\?$/).last();
  await expect(asked).toBeVisible();
  const question = (await asked.textContent())!;
  await page.getByRole("group", { name: "Your answer" }).getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("group", { name: "Your answer" }).getByRole("button", { name: /^That.s all$/ }).click();
  await expect(page.getByText("That's your standup. I put your answers together below for you to review.")).toBeVisible();
  // The answers are one update, read as usual: Done, with its question as the words it came from
  await expect(page.getByText("Your standup answers, as one update")).toBeVisible();
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/review\//);
  await expect(card(question.replace(/ is In progress\..*$/, ""))).toBeVisible();
  await expect(page.getByText(question).first()).toBeVisible();
});

test("Phase J. One standup a day: asking again says it is done (SU10)", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Start my standup");
  await box.press("Enter");
  await expect(page.getByText("You've done your standup today. You can still send me an update any time.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Your answer" })).toHaveCount(0);
});

test("Phase K, CD13. Alicia marks GQ & Academy paused, so Atlas will not flag it as quiet, then resumes it", async () => {
  await viewAs("kemar", "/projects/gq");
  await expect(page.getByRole("button", { name: "Mark paused" })).toHaveCount(0); // only the PM marks it
  await viewAs("alicia", "/projects/gq");
  await page.getByRole("button", { name: "Mark paused" }).click();
  await expect(page.getByText("Paused: Atlas will not flag it as quiet")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: "Mark paused" })).toBeVisible();
  await expect(page.getByText("Paused: Atlas will not flag it as quiet")).toHaveCount(0);
});

/** Phase K: Kemar says the store feed is still blocked, a report on the blocker on the log (M16 same as), saved from its review. */
async function kemarSaysFeedStillBlocked() {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("The Sprouts store feed is still blocked for me too.");
  await box.press("Enter");
  await page.getByRole("button", { name: /^Review/ }).last().click();
  await expect(page).toHaveURL(/\/review\//);
  await card("Store sales feed access").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();
}
const noticed = () => page.getByRole("link", { name: /The blocker "Store sales feed access" was reported again on 20 Oct after it was resolved/ });

test("Phase K. Alicia resolves the feed blocker; Kemar reports it again, so Atlas notices it came back, and Alicia accepts it as a risk", async () => {
  await viewAs("alicia", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("What's blocked on Forager?");
  await box.press("Enter");
  const line = page.getByRole("listitem").filter({ hasText: "Store sales feed access" }).filter({ hasText: "Blocker" });
  await line.getByRole("button", { name: "Resolve" }).click();
  await expect(line.getByText("Resolved.")).toBeVisible();

  // His report reopens the same entry (S14); the save raises the signal, to the PM and Leads, not to him (M29)
  await kemarSaysFeedStillBlocked();
  await page.goto("/?view=inbox");
  await expect(noticed()).toHaveCount(0);
  await viewAs("alicia", "/?view=inbox");
  await noticed().first().click();
  await expect(page.getByText("Nobody reported this: Atlas noticed it in the plan and the log.")).toBeVisible();
  await page.getByRole("button", { name: "Accept as a risk" }).click();
  // Answered, the item closes as acted
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
  await page.goto("/projects/forager?view=table");
  await expect(page.locator("details").filter({ hasText: "Store sales feed access may keep blocking work" }).locator("summary")).toContainText("Open");
});

test("Phase K, SG5. Kemar reports it once more: Atlas offers the risk Alicia filed, and she adds it there", async () => {
  await kemarSaysFeedStillBlocked();
  await viewAs("alicia", "/?view=inbox");
  await noticed().first().click();
  await expect(page.getByRole("button", { name: "New risk" })).toBeVisible();
  await page.getByRole("button", { name: "Add to “Store sales feed access may keep blocking work”" }).click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
  // Still one risk: the signal is a second source on it, never a second entry
  await page.goto("/projects/forager?view=table");
  await expect(page.locator("details").filter({ hasText: "Store sales feed access may keep blocking work" })).toHaveCount(1);
});

test("Phase K. Kemar reports it again: Alicia dismisses it and says why, and it leaves her inbox", async () => {
  await kemarSaysFeedStillBlocked();
  await viewAs("alicia", "/?view=inbox");
  await noticed().first().click();
  await expect(page.getByRole("button", { name: "Dismiss" })).toBeDisabled(); // a dismissal says why
  await page.getByLabel("Why dismiss it").fill("Kyle is chasing Sprouts IT this week");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});

test("Phase E. Kemar promises to send Kyle the access request: a promise he reviews and saves, then finds when he asks what he promised", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("I'll send Kyle the access request for #151 tomorrow.");
  await box.press("Enter");
  // A promise is his alone (CD3): it goes to "You", never to Forager
  await expect(page.getByText("You · 1 personal item, only you see it")).toBeVisible();
  await page.getByRole("button", { name: /^Review/ }).last().click();
  await expect(page).toHaveURL(/\/review\//);
  // The day is read from "tomorrow" and shown to correct (CM2), with the record it names
  const promise = card("Send Kyle the access request");
  await expect(promise).toContainText('Due Wed 21 Oct, you said "tomorrow" · #151 Store sales feed access');
  await expect(promise).toContainText("Only you see your promises");
  await promise.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();
  // CM12: what he promised, his own only, soonest first
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  await box.fill("What did I promise?");
  await box.press("Enter");
  await expect(page.getByRole("link", { name: /Send Kyle the access request.*Due Wed 21 Oct · #151 Store sales feed access/ })).toBeVisible();
  // Each open promise carries its own Done, New date and Drop, so he can end one before it is due (M22 anyLive)
  const own = page.getByRole("group", { name: "Promised: Send Kyle the access request" });
  await expect(own.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await expect(own.getByRole("button", { name: "Drop it" })).toBeVisible();
});

test("Phase E. Kemar's promise from Friday was due Monday: Tuesday morning's check-in is in his inbox and chat, and Done ends it", async () => {
  // The first timer run after the server starts checks in on it (a notice and an inbox item until phase F)
  await viewAs("kemar", "/?view=inbox");
  const checkIn = page.getByRole("link", { name: /Did you send Andre the buyers' column list\?/ });
  await expect(async () => {
    await page.reload();
    await expect(checkIn).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await checkIn.click();
  await expect(page.getByText(/you said you would by Mon 19 Oct/).first()).toBeVisible();
  // The chat shows the same check-in, with the same buttons
  await viewAs("kemar", "/?view=chat");
  await expect(page.getByText("Did you send Andre the buyers' column list? You said you would by Mon 19 Oct.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Your promise" }).getByRole("button", { name: "New date" })).toBeVisible();
  await page.getByRole("group", { name: "Your promise" }).getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Marked done.", { exact: true })).toBeVisible();
  // Answered, it leaves his inbox
  await page.goto("/?view=inbox");
  await expect(checkIn).toHaveCount(0);
});

test("Phase O. Kemar's meeting note: he says Alicia was there and knew it was recorded; her promise is hers to confirm, and she confirms it", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  await page.getByLabel("Meeting note").check();
  await page.getByRole("combobox", { name: "Meeting project" }).selectOption({ label: "Forager 2.0" });
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Forager sync with Alicia. Alicia: I'll send Kyle the buyer list Friday.");
  await box.press("Enter");
  // M33: nothing is read until he says who was there and that they knew (MT4)
  const who = page.getByRole("group", { name: "Who was there" });
  await expect(who).toContainText("Meeting note for Forager 2.0. Who was there?");
  await expect(who.getByRole("button", { name: "Read it for everyone there" })).toBeDisabled();
  await who.getByLabel("Alicia Campbell").check();
  await who.getByLabel("Everyone there knew it was recorded").check();
  await who.getByRole("button", { name: "Read it for everyone there" }).click();
  // Her promise goes to her; nothing of hers is in his review (rule 10)
  await expect(page.getByText("Got it. Each part is with the person it is about.")).toBeVisible();
  const parts = page.getByRole("list", { name: "About the people there" });
  await expect(parts).toContainText("Alicia: Send Kyle the buyer list, by Fri 23 Oct");
  await expect(parts).toContainText("Sent to Alicia to confirm.");

  // M34: an inbox item and a notice in her chat (no phase F yet); she sees only the words that fed it (rule 9)
  await viewAs("alicia", "/?view=chat");
  await expect(page.getByText("Kemar's meeting note on Forager 2.0 says this is yours: Send Kyle the buyer list, by Fri 23 Oct.", { exact: false })).toBeVisible();
  await page.goto("/?view=inbox");
  await page.getByRole("link", { name: /Kemar's meeting note: Send Kyle the buyer list, by Fri 23 Oct/ }).first().click();
  await expect(page.getByText("“Alicia: I'll send Kyle the buyer list Friday.”")).toBeVisible();
  await expect(page.getByText("Forager sync with Alicia")).toHaveCount(0);
  await page.getByRole("group", { name: "Is this right?" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Saved as yours.")).toBeVisible();
  // It is her own promise now, private to her (CD3)
  await viewAs("alicia", "/?view=chat&c=new&ask=1");
  await box.fill("What did I promise?");
  await box.press("Enter");
  await expect(page.getByRole("link", { name: /Send Kyle the buyer list.*Due Fri 23 Oct/ })).toBeVisible();
  // Kemar's note says she confirmed it
  await viewAs("kemar", "/?view=chat");
  await expect(page.getByRole("list", { name: "About the people there" }).first()).toContainText("Alicia confirmed it.");
});

test("Phase O, MT9. Kemar's Sprouts call could be about two of his projects: Atlas asks which, then drafts a client-safe brief", async () => {
  await viewAs("kemar", "/?view=chat&c=new&ask=1");
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await box.fill("Prep me for the Sprouts call");
  await box.press("Enter");
  await expect(page.getByText("Which project is the call about: Forager 2.0 or Store Insights?")).toBeVisible();
  await page.getByRole("group", { name: "Choose one" }).getByRole("button", { name: "Forager 2.0" }).click();
  await expect(page.getByText("Got it: Forager 2.0. Your brief follows.")).toBeVisible();
  // Only what the client may see (rule 8): the releases by their target date, never internal milestones or work
  const brief = page.getByRole("textbox", { name: "Your call brief" });
  await expect(brief).toHaveValue(/Buyer pilot · Release 1: planned Fri 30 Oct/);
  await expect(brief).not.toHaveValue(/Trend model|#151|Data sources/);
});
