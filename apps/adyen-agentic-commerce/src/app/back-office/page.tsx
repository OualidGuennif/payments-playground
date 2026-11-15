// Spec: knowledge/components/adyen-agentic-commerce.md
import { StatusPill } from "@/components/StatusPill";
import { money } from "@/lib/money";
import { backOfficeView } from "@/server/api";

export const metadata = { title: "Back Office" };
export const dynamic = "force-dynamic";

export default function BackOffice() {
  const { orders, payments, checkouts, trace } = backOfficeView();
  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h1 className="text-3xl">Back Office</h1>
        <p className="text-sm text-muted">Orders, Adyen answers and every protocol exchange. Tokens, assertions and card tokens are redacted.</p>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl">Payments</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="p-3">Reference</th><th className="p-3">Kind</th><th className="p-3">Amount</th><th className="p-3">Result</th><th className="p-3">PSP reference</th><th className="p-3">When</th></tr></thead>
            <tbody className="divide-y divide-line">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="p-3 font-mono text-xs">{p.reference}</td>
                  <td className="p-3">{p.purpose}{p.agentName ? ` · ${p.agentName}` : ""}</td>
                  <td className="p-3 tabular-nums">{money(p.amount)}</td>
                  <td className="p-3"><StatusPill status={p.resultCode ?? "pending"} />{p.refusalReason ? <span className="block text-xs text-muted">{p.refusalReason}</span> : null}</td>
                  <td className="p-3 font-mono text-xs">{p.pspReference ?? "–"}</td>
                  <td className="p-3 text-xs text-muted">{new Date(p.updatedAt).toLocaleString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.length ? null : <p className="p-3 text-sm text-muted">No payment yet.</p>}
        </div>
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-xl">Orders</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 p-3">
                <a href={`/orders/${o.id}`} className="font-mono text-xs underline">{o.id}</a>
                <StatusPill status={o.status} />
                <span className="text-xs text-muted">{o.paidBy === "agent" ? o.agentName : "shopper"}{o.webhook ? " · webhook ✓" : ""}</span>
                <span className="ml-auto tabular-nums">{money(o.total)}</span>
              </li>
            ))}
            {orders.length ? null : <li className="p-3 text-muted">No order yet.</li>}
          </ul>
        </div>
        <div className="space-y-3">
          <h2 className="text-xl">Checkouts</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
            {checkouts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
                <a href={`/checkout/${c.id}`} className="font-mono text-xs underline">{c.id}</a>
                <StatusPill status={c.phase} />
                <span className="text-xs text-muted">{c.agentName ?? "anonymous"} · {c.attempts} attempt(s)</span>
                <span className="ml-auto tabular-nums">{money(c.total)}</span>
              </li>
            ))}
            {checkouts.length ? null : <li className="p-3 text-muted">No checkout yet.</li>}
          </ul>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">Protocol trace</h2>
        <ol className="space-y-2">
          {trace.map((t) => (
            <li key={t.id} className="rounded-xl border border-line bg-card text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3">
                  <span className="pill border-line">{t.channel}</span>
                  <span className="font-mono text-xs">{t.method} {t.path}</span>
                  <span className={t.status >= 400 ? "text-bad" : "text-ok"}>{t.status}</span>
                  <span className="text-xs text-muted">{t.actor}</span>
                  <span className="ml-auto text-xs text-muted">{new Date(t.at).toLocaleTimeString("en-GB")}</span>
                </summary>
                <pre className="max-h-96 overflow-auto border-t border-line p-3 text-xs">{JSON.stringify(t.detail, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
