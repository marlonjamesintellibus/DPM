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
  await expect(card("Move the daily refresh to 6am")).toContainText('Store Insights · "On Store Insights"');
  await expect(card("Leave Kemar Brown")).toContainText("Matches approved leave");
  // Nothing is saved until he confirms: Save waits for the 4 that need his OK
  await expect(page.getByText("4 need your OK before this is saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 9 updates" })).toBeDisabled();
});

test("Section 15. Kemar asks Atlas what needs him: the answer links his waiting review", async () => {
  await viewAs("kemar", "/projects");
  await page.getByRole("link", { name: "Ask Atlas" }).first().click();
  const box = page.getByRole("textbox", { name: "Message to Atlas" });
  await expect(box).toBeFocused();
  await box.fill("What needs me to review it today?");
  await box.press("Enter");
  await expect(page.getByText("1 thing needs you:")).toBeVisible();
  await expect(page.getByText("Got it. Nothing in this one changes a project.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Your update from 8:58am is waiting for review: 4 need your OK" })).toHaveAttribute("href", "/review/cap-kemar-0858");
});

test("3. Alicia set Forager 2.0 Off track at 9:02 with no reason", async () => {
  await viewAs("alicia");
  await expect(page.getByRole("link", { name: /Forager 2.0 is set Off track, but the plan says/ }).first()).toBeVisible();
});

test("4. Kemar accepts #4, #8 and #9, edits #6 and saves: 9 changes for 2 projects", async () => {
  await viewAs("kemar", "/review/cap-kemar-0858");
  for (const text of ["Milestone Trend model", "Trend model may slip to 24 Oct", "Only Kemar can run the pipeline"]) {
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
  await expect(page.locator("details").filter({ hasText: "Trend model may slip to 24 Oct" }).locator("summary")).toContainText("Waiting for PM or Lead");
  await page.goto("/projects/forager");
  await expect(page.locator("section").filter({ hasText: "Plan" }).first()).toContainText("At risk");
});

test("6. Alicia's Today: she approves Kemar's risk, then saves the reason linked to the blocker and the risk", async () => {
  await viewAs("alicia", "/?view=inbox");
  await expect(page.getByRole("link", { name: "Forager 2.0 is set Off track, but the plan says At risk" }).first()).toBeVisible();
  await page.getByRole("link", { name: /Kemar raised a risk: Trend model may slip to 24 Oct/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("link", { name: /Kemar raised a risk/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Forager 2.0 is set Off track, but the plan says At risk" }).first().click();
  await expect(page.getByLabel("Reason")).not.toBeEmpty();
  for (const chip of ["Blocker · Store sales feed access", "Risk · Trend model may slip to 24 Oct"]) {
    const button = page.getByRole("button", { name: new RegExp(`^${chip}`) }).first();
    if ((await button.getAttribute("aria-pressed")) === "false") await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});

test("7. Andre approves Kemar's decision; it is on the Store Insights log with Andre as approver", async () => {
  await viewAs("andre", "/?view=inbox");
  await page.getByRole("link", { name: /Kemar proposed a decision: move the daily refresh to 6am/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("link", { name: /Kemar proposed a decision/ })).toHaveCount(0);
  await page.goto("/projects/insights?view=table");
  const decision = page.locator("details").filter({ hasText: "Move the daily refresh to 6am" });
  await expect(decision.locator("summary")).toContainText("Approved");
  await decision.locator("summary").click();
  await expect(decision).toContainText("Andre and I agreed to move the refresh to 6am");
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
