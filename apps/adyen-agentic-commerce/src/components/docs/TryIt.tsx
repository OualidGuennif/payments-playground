// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useState } from "react";
import { CopyButton } from "@/components/back-office/CopyButton";
import type { TryRequest } from "./content";

type Result =
  | { label: string; status: number; headers: [string, string][]; body: string }
  | { label: string; failed: string };

const SHOWN_HEADERS = ["content-type", "cache-control", "www-authenticate"];

// The request leaves from the visitor's browser to this origin, without cookies: what it shows is
// what any agent would see, and nothing it sends signs in, pays or changes state.
export async function send(request: TryRequest): Promise<Response> {
  return fetch(request.path, {
    method: request.method,
    credentials: "omit",
    cache: "no-store",
    headers:
      request.method === "POST"
        ? { "content-type": "application/json", accept: "application/json, text/event-stream" }
        : { accept: "application/json" },
    body:
      request.method === "POST"
        ? JSON.stringify({ jsonrpc: "2.0", id: 1, ...request.body })
        : undefined,
  });
}

export function TryIt({ requests }: { requests: TryRequest[] }) {
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState<string>();

  async function run(request: TryRequest) {
    setBusy(request.label);
    try {
      const res = await send(request);
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON: shown as it came.
      }
      const headers = SHOWN_HEADERS.flatMap((h): [string, string][] => {
        const v = res.headers.get(h);
        return v ? [[h, v]] : [];
      });
      setResult({ label: request.label, status: res.status, headers, body: body.slice(0, 20_000) });
    } catch {
      setResult({ label: request.label, failed: "The request did not reach the store." });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="panel space-y-4" aria-labelledby="try-it">
      <div className="space-y-1">
        <h2 id="try-it" className="text-xl">
          Try it
        </h2>
        <p className="text-sm text-muted">
          Sent from your browser to this store, without your cookies: you see what an agent sees.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {requests.map((r) => (
          <button
            key={r.label}
            type="button"
            className="btn-ghost px-4 font-mono text-xs"
            disabled={Boolean(busy)}
            onClick={() => run(r)}
          >
            {busy === r.label ? "Sending…" : r.label}
          </button>
        ))}
      </div>
      {result ? (
        <div className="space-y-2" aria-live="polite">
          {"failed" in result ? (
            <p role="alert" className="text-sm text-bad">
              {result.failed}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={`pill ${
                    result.status < 300
                      ? "border-ok text-ok"
                      : result.status < 500
                        ? "border-warn text-warn"
                        : "border-bad text-bad"
                  }`}
                >
                  {result.status}
                </span>
                <span className="min-w-0 break-all font-mono text-xs text-muted">
                  {result.label}
                </span>
                <span className="ml-auto">
                  <CopyButton text={result.body} label="Copy" />
                </span>
              </div>
              {result.headers.length ? (
                <dl className="space-y-0.5 font-mono text-xs">
                  {result.headers.map(([k, v]) => (
                    <div key={k} className="break-all">
                      <dt className="inline text-muted">{k}: </dt>
                      <dd className="inline">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <pre className="max-h-96 overflow-auto rounded-xl bg-paper p-3 text-xs">
                {result.body}
              </pre>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
