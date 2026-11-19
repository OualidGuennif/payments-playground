// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl">This page could not finish loading.</h1>
      <p className="text-sm text-muted">
        Try loading the view again, or return to the store. Your session and saved orders stay on
        the server.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back to store
        </Link>
      </div>
    </div>
  );
}
