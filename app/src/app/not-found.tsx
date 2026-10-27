// Anything that does not exist or is not the viewer's: the two are never told apart (P10), so a
// project or an update someone else owns reads exactly like a wrong address.
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <section className="flex w-full max-w-[420px] flex-col gap-3 rounded-lg border border-line bg-panel p-6">
        <h1 className="type-heading text-fg-1">Not found, or not yours to see</h1>
        <p className="type-body text-fg-2">Projects and updates show only to the people in them. If you think you should see this, ask its PM to add you.</p>
        <Link href="/" className="self-start rounded-control bg-inverse px-2.5 py-1 type-label text-on-inverse">
          Back to Today
        </Link>
      </section>
    </main>
  );
}
