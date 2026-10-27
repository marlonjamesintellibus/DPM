"use client";
// The last resort, when even the root layout failed: plain words and a way back, with no app styles.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 18 }}>DPM could not load</h1>
        <p>Nothing you saved is lost. Try again in a moment.</p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  );
}
