import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ViewerShell } from "@/app/_lib/shell";
import { currentViewer } from "@/app/_lib/viewer";
import { startReview } from "@/app/actions";
import { PageHead } from "@/components/shell/app-shell";
import { ReviewScreen } from "@/components/review/review-screen";
import { Button } from "@/components/ui/controls";
import { getDb } from "@/db/client";
import { getReview } from "@/queries/review";

// Review my update (L16b). Only the author can read their own update (M1).
export default function ReviewPage({ params }: PageProps<"/review/[captureId]">) {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <Review params={params} />
    </Suspense>
  );
}

async function Review({ params }: { params: PageProps<"/review/[captureId]">["params"] }) {
  // Per request: the viewer, the database and the clock are all read at request time
  await connection();
  const { captureId } = await params;
  const viewer = await currentViewer();
  const review = await getReview(await getDb(), viewer.id, captureId);
  if (!review.found) notFound();
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Jamaica", hour: "numeric", minute: "2-digit" }).format(review.capture.messageAt).replace(" ", "").toLowerCase();
  const from = review.capture.kind === "voice" ? `your voice note at ${time}` : `your message at ${time}`;
  const state = review.capture.state;
  return (
    // "Today" goes back to the chat, in the conversation this message came from
    <ViewerShell breadcrumb={[{ label: "Today", href: `/?view=chat${review.capture.conversationId ? `&c=${review.capture.conversationId}` : ""}` }, "Review my update"]} activeHref="/">
      <PageHead title="Review my update">
        <span className="px-2.5 py-1 type-body text-fg-2">
          From {from}. {review.footer.split(". ")[0].replace(/\.$/, "")}.{" "}
          {state === "saved" ? "Saved." : state === "rejected" ? "Discarded." : state === "expired" ? "Expired: nothing was saved." : "Nothing is saved until you confirm."}
        </span>
      </PageHead>
      <div className="flex flex-1 flex-col gap-4 overflow-auto px-7 pt-5 pb-7">
        {state === "proposed" && (
          <form action={startReview.bind(null, captureId)} className="flex items-center gap-3">
            <Button type="submit">Start review</Button>
            <span className="type-caption text-fg-3">Opening the review lets you accept, change or reject each item.</span>
          </form>
        )}
        <ReviewScreen review={review} />
      </div>
    </ViewerShell>
  );
}

function ReviewSkeleton() {
  return <div className="min-h-screen bg-canvas" aria-busy="true" />;
}
