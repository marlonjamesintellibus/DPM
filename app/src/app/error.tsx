"use client";
// A page that failed to load (P11: say so, never a blank screen). Nothing a person saved is lost:
// every change is one transaction, so a failure leaves the data as it was before.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as { digest?: string }).digest ?? "") : "";
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <section role="alert" className="flex w-full max-w-[420px] flex-col gap-3 rounded-lg border border-line bg-panel p-6">
        <h1 className="type-heading text-fg-1">This page could not load</h1>
        <p className="type-body text-fg-2">Nothing you saved is lost. Try again, or go back to Today.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => retry()} className="rounded-control bg-inverse px-2.5 py-1 type-label text-on-inverse">
            Try again
          </button>
          <Link href="/" className="rounded-control border border-line-strong bg-panel px-2.5 py-1 type-label text-fg-1 hover:bg-hover">
            Back to Today
          </Link>
        </div>
        {digest && <p className="type-micro text-fg-3">Reference {digest}</p>}
      </section>
    </main>
  );
}
