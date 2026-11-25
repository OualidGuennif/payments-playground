// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/StatusPill";
import { money } from "@/lib/money";
import type { Order } from "@/server/commerce/commerce";
import { get } from "@/server/core/db";

export const metadata = { title: "Order" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const order = get<Order>("orders", (await params).id);
  if (!order) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">Order {order.id.slice(4, 12)}</h1>
        <StatusPill status={order.status} />
      </div>
      <div className="space-y-1 text-sm text-muted">
        <p>
          {order.paidBy === "agent" ? `Paid by ${order.agentName ?? "your agent"}` : "Paid by you"}{" "}
          on {new Date(order.createdAt).toLocaleString("en-GB")}.
        </p>
        <p className="text-xs">
          Adyen reference <span className="code">{order.pspReference ?? "pending"}</span>.{" "}
          {order.webhook
            ? `Adyen's ${order.webhook.eventCode} notification arrived.`
            : "Waiting for Adyen's notification."}
        </p>
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {order.lines.map((l) => (
          <li key={l.variantId} className="flex justify-between gap-3 p-3">
            <span>
              {l.title} <span className="text-muted">× {l.quantity}</span>
            </span>
            <span className="tabular-nums">{money(l.unitPrice * l.quantity)}</span>
          </li>
        ))}
        <li className="flex justify-between p-3">
          <span>Shipping</span>
          <span className="tabular-nums">
            {order.fulfillment ? money(order.fulfillment) : "Free"}
          </span>
        </li>
        <li className="flex justify-between p-3 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{money(order.total)}</span>
        </li>
      </ul>
      <Link href="/shop" className="btn-ghost">
        Continue shopping
      </Link>
    </div>
  );
}
